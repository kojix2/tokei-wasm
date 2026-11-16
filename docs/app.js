// Source analysis runs in worker.js; this module handles input, results and exports.
import {isExcluded} from './languages.js';
const $ = (sel) => document.querySelector(sel);
const fmt = (value) => Number(value || 0).toLocaleString('en-US');
const sourceControls = ['analyze-button', 'folder-input', 'files-input', 'choose-folder', 'choose-files'].map(id => $(`#${id}`));
let worker;
let busy = false;
let activeRequest = 0;
let current = null;
let sortKey = 'code';
let sortDesc = true;
let searchQuery = '';
const expanded = new Set();

function setTab(name) {
  for (const choice of ['github', 'local']) {
    const selected = choice === name;
    $(`#tab-${choice}`).setAttribute('aria-selected', String(selected));
    $(`#tab-${choice}`).tabIndex = selected ? 0 : -1;
    $(`#${choice}-panel`).classList.toggle('hidden', !selected);
  }
}
$('#tab-github').addEventListener('click', () => setTab('github'));
$('#tab-local').addEventListener('click', () => setTab('local'));
$('.tabs').addEventListener('keydown', ev => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
  ev.preventDefault();
  const name = ev.key === 'Home' ? 'github' : ev.key === 'End' ? 'local' :
    $('#tab-github').getAttribute('aria-selected') === 'true' ? 'local' : 'github';
  setTab(name); $(`#tab-${name}`).focus();
});
$('#example').addEventListener('click', () => {$('#repo-url').value = 'https://github.com/kojix2/tokei-api'; $('#repo-url').focus();});

function setBusy(value) {
  busy = value;
  $('#progress-box').classList.toggle('hidden', !value);
  for (const control of sourceControls) control.disabled = value;
  $('#drop-zone').setAttribute('aria-busy', String(value));
}
function startProgress(label) {
  setBusy(true);
  $('#error-alert').classList.add('hidden');
  $('#progress-label').textContent = label;
  $('#progress-count').textContent = '';
  $('#progress-fill').removeAttribute('value');
  $('#activity-status').textContent = label;
}
function showError(message) {
  setBusy(false);
  $('#error-alert').textContent = message;
  $('#error-alert').classList.remove('hidden');
}
function run(message) {
  if (busy) return;
  startProgress('Starting analysis…');
  const id = ++activeRequest;
  try {
    if (!worker) {
      worker = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
      worker.addEventListener('message', onWorkerMessage);
      const failed = () => {
        worker?.terminate(); worker = null; activeRequest++;
        showError('The analysis engine could not be loaded. Reload the page and try again.');
      };
      worker.addEventListener('error', failed);
      worker.addEventListener('messageerror', failed);
    }
    worker.postMessage({...message, id});
  } catch (err) {showError(err.message);}
}
$('#github-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if ($('#analyze-button').disabled) return;
  run({type: 'github', url: $('#repo-url').value});
});
function runFiles(files) {
  if (files?.length && !busy) {
    setTab('local');
    run({type: 'local', files: Array.from(files, record => record.file ? record :
      ({file: record, path: record.webkitRelativePath || record.name}))});
  }
}
for (const kind of ['folder', 'files']) {
  $(`#choose-${kind}`).addEventListener('click', () => $(`#${kind}-input`).click());
  $(`#${kind}-input`).addEventListener('change', ev => {runFiles(ev.target.files); ev.target.value = '';});
}
$('#cancel').addEventListener('click', () => {
  activeRequest++; worker?.terminate(); worker = null;
  setBusy(false); $('#activity-status').textContent = 'Analysis canceled.';
});
function onWorkerMessage({data}) {
  if (!busy || data.id !== activeRequest) return;
  if (data.type === 'progress') {
    $('#progress-label').textContent = data.label;
    $('#progress-count').textContent = data.total ? `${fmt(data.done)} / ${fmt(data.total)} files` : '';
    if (data.total) $('#progress-fill').value = 100 * data.done / data.total;
    else $('#progress-fill').removeAttribute('value');
  } else if (data.type === 'error') {
    showError(data.message);
  } else if (data.type === 'result') {
    setBusy(false); current = data.data; expanded.clear();
    sortKey = 'code'; sortDesc = true; searchQuery = '';
    $('#language-search').value = '';
    showResults();
  }
}

// Read folder entries in batches: readEntries may return only part of a folder.
async function readDroppedEntry(entry, records, request) {
  if (request !== activeRequest) return;
  const path = entry.fullPath.replace(/^\//, '');
  if (isExcluded(entry.isDirectory ? `${path}/_` : path)) return;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    records.push({file, path});
    $('#progress-count').textContent = `${fmt(records.length)} files found`;
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      if (request !== activeRequest) return;
      const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!entries.length) break;
      for (const child of entries) await readDroppedEntry(child, records, request);
    }
  }
}
const dropZone = $('#drop-zone');
for (const event of ['dragenter', 'dragover']) dropZone.addEventListener(event, ev => {
  ev.preventDefault(); if (!busy) dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', ev => {if (!dropZone.contains(ev.relatedTarget)) dropZone.classList.remove('drag-over');});
dropZone.addEventListener('drop', async ev => {
  ev.preventDefault(); dropZone.classList.remove('drag-over');
  if (busy) return;
  const entries = Array.from(ev.dataTransfer.items || [], item => item.webkitGetAsEntry?.()).filter(Boolean);
  const fallback = Array.from(ev.dataTransfer.files);
  const request = ++activeRequest;
  startProgress('Reading dropped files…');
  try {
    const records = [];
    for (const entry of entries) await readDroppedEntry(entry, records, request);
    if (request !== activeRequest) return;
    setBusy(false);
    const files = entries.length ? records : fallback;
    if (files.length) runFiles(files);
    else showError('Drop a folder or source files to analyze.');
  } catch (err) {if (request === activeRequest) showError(`Could not read dropped files: ${err.message}`);}
});
// Prevent the browser from navigating away when a file misses the drop area.
for (const name of ['dragover', 'drop']) window.addEventListener(name, ev => {
  if (Array.from(ev.dataTransfer?.types || []).includes('Files')) ev.preventDefault();
});

function lineTotal(stat) {return stat.code + stat.comments + stat.blanks;}
function languageEntries() {return Object.entries(current.results).filter(([name]) => name !== 'Total');}
function showResults() {
  if (!current) return;
  const {title, detail, results, warnings, skipped, analyzedAt} = current;
  const total = results.Total;
  $('#results-title').textContent = title;
  const at = new Date(analyzedAt).toLocaleString();
  $('#results-subtitle').textContent = [detail?.ref, at, skipped ? `${fmt(skipped)} omitted` : ''].filter(Boolean).join(' · ');
  $('#stat-code').textContent = fmt(total.code);
  $('#stat-languages').textContent = fmt(languageEntries().length);
  $('#stat-files').textContent = fmt(total.files);
  $('#stat-lines').textContent = fmt(lineTotal(total));
  $('#activity-status').textContent = `Analysis complete. ${fmt(total.files)} files, ${fmt(total.code)} lines of code.`;
  const note = $('#warning-box');
  if (warnings.length) {note.textContent = warnings.join(' '); note.classList.remove('hidden');}
  else note.classList.add('hidden');
  $('#results').classList.remove('hidden');
  renderTable(); renderComposition();
  $('#badges').replaceChildren();
  if ($('#badge-options').open) renderBadges();
  $('#results').scrollIntoView({behavior: 'smooth', block: 'start'});
}

function createCell(value, parent, tag='td') {
  const cell = document.createElement(tag);
  cell.textContent = typeof value === 'number' ? fmt(value) : value;
  parent.append(cell);
  return cell;
}
function renderDetails(container, reports) {
  const table = document.createElement('table'); table.className = 'details-table';
  const head = table.createTHead().insertRow();
  for (const label of ['File', 'Code', 'Comments', 'Blanks', 'Total']) createCell(label, head, 'th');
  const tbody = table.createTBody();
  for (const report of reports) {
    const row = tbody.insertRow();
    const cell = row.insertCell();
    if (current.detail) {
      const {owner, repo, ref} = current.detail;
      const link = document.createElement('a');
      const branch = encodeURIComponent(current.detail.revision || ref);
      const path = report.name.split('/').map(encodeURIComponent).join('/');
      link.href = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${branch}/${path}`;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = report.name;
      cell.append(link);
    } else cell.textContent = report.name;
    for (const key of ['code','comments','blanks']) createCell(report.stats[key], row);
    createCell(lineTotal(report.stats), row);
  }
  container.append(table);
}
function renderTable() {
  if (!current) return;
  const tbody = $('#language-rows'); tbody.replaceChildren();
  const sorted = languageEntries().filter(([name, stat]) => !searchQuery || name.toLowerCase().includes(searchQuery) ||
    stat.reports.some((report) => report.name.toLowerCase().includes(searchQuery)));
  sorted.sort((a,b) => {
    const key = sortKey;
    const va = key === 'name' ? a[0] : key === 'files' ? a[1].reports.length : key === 'total' ? lineTotal(a[1]) : a[1][key];
    const vb = key === 'name' ? b[0] : key === 'files' ? b[1].reports.length : key === 'total' ? lineTotal(b[1]) : b[1][key];
    const diff = typeof va === 'string' ? va.localeCompare(vb) : va-vb;
    return sortDesc ? -diff : diff;
  });
  for (const button of document.querySelectorAll('[data-sort]')) {
    const selected = button.dataset.sort === sortKey;
    button.parentElement.setAttribute('aria-sort', selected ? (sortDesc ? 'descending' : 'ascending') : 'none');
  }
  for (const [name, stat] of sorted) {
    const row = document.createElement('tr'); row.className = 'language-row';
    const isOpen = expanded.has(name);
    row.tabIndex = 0;
    row.setAttribute('aria-expanded', String(isOpen));
    row.dataset.language = name;
    const first = row.insertCell();
    const strong = document.createElement('strong'); strong.textContent = name; first.append(strong);
    for (const value of [stat.reports.length,stat.code,stat.comments,stat.blanks,lineTotal(stat)]) createCell(value,row);
    tbody.append(row);
    if (isOpen) {
      const details = tbody.insertRow(); details.className = 'details-row';
      const cell = details.insertCell(); cell.colSpan = 6;
      renderDetails(cell, stat.reports.filter(report => !searchQuery ||
        name.toLowerCase().includes(searchQuery) || report.name.toLowerCase().includes(searchQuery)));
    }
  }
  if (!sorted.length) {
    const cell = tbody.insertRow().insertCell(); cell.colSpan = 6; cell.className = 'empty-state';
    cell.textContent = 'No matching languages or files.';
  }
  const foot = $('#table-foot'); foot.replaceChildren();
  const final = foot.insertRow(); final.className = 'total-row';
  const t = current.results.Total;
  for (const value of ['TOTAL',t.files,t.code,t.comments,t.blanks,lineTotal(t)]) createCell(value,final,'th');
}
function toggleLanguage(event) {
  const row = event.target.closest('.language-row');
  if (!row || (event.type === 'keydown' && !['Enter', ' '].includes(event.key))) return;
  event.preventDefault();
  const name = row.dataset.language;
  if (expanded.has(name)) expanded.delete(name); else expanded.add(name);
  renderTable();
  Array.from($('#language-rows').querySelectorAll('.language-row')).find(row => row.dataset.language === name)?.focus({preventScroll: true});
}
$('#language-rows').addEventListener('click', toggleLanguage);
$('#language-rows').addEventListener('keydown', toggleLanguage);
$('#language-search').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  expanded.clear();
  if (searchQuery && current) for (const [name, stat] of languageEntries()) {
    if (stat.reports.some(r => r.name.toLowerCase().includes(searchQuery))) expanded.add(name);
  }
  renderTable();
});
$('#language-table thead').addEventListener('click', (e) => {
  const button = e.target.closest('[data-sort]'); if (!button) return;
  if (sortKey === button.dataset.sort) sortDesc = !sortDesc;
  else {sortKey = button.dataset.sort;sortDesc = sortKey !== 'name';}
  renderTable();
});

function renderComposition() {
  const total = current.results.Total;
  const lines = lineTotal(total);
  const labels = [];
  const segments = ['code', 'comments', 'blanks'].map(key => {
    const share = lines ? 100 * total[key] / lines : 0;
    const segment = document.createElement('span');
    segment.style.width = `${share}%`;
    labels.push(`${key[0].toUpperCase() + key.slice(1)} ${Math.round(share)}%`);
    return segment;
  });
  $('#composition-bar').replaceChildren(...segments);
  $('#composition-bar').setAttribute('aria-label', labels.join(' · '));
  $('#composition-legend').textContent = labels.join(' · ');
}

function markdownBadges() {
  const total = current.results.Total;
  const languages = languageEntries().sort((a,b)=>b[1].code-a[1].code);
  const top = languages[0]?.[0] || 'Unknown';
  const ratio = total.comments ? (total.code/total.comments).toFixed(1) : 'N/A';
  const where = current.detail ? `${location.origin}${location.pathname}?repo=${encodeURIComponent(`${current.detail.owner}/${current.detail.repo}`)}` : location.href.split('?')[0];
  return [
    ['Lines of Code','LOC',fmt(total.code)],
    ['Top Language','Top_language',top],
    ['Languages','Languages',String(languages.length)],
    ['Code / Comment','Code_to_comment',ratio],
  ].map(([title,label,value])=> {
    const encodedVal = encodeURIComponent(value).replace(/-/g,'--').replace(/_/g,'__');
    const url = `https://img.shields.io/badge/${label}-${encodedVal}-555`;
    return {title,url,markdown:`[![${title}](${url})](${where})`};
  });
}
async function copyText(text,button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea=document.createElement('textarea');textarea.value=text;document.body.append(textarea);
    textarea.select();
    let copied = false;
    try {copied = document.execCommand('copy');} finally {textarea.remove();}
    if (!copied) {button.textContent='Copy failed';setTimeout(()=>button.textContent='Copy MD',1300);return;}
  }
  const old=button.textContent;button.textContent='Copied!';setTimeout(()=>button.textContent=old,1300);
}
function renderBadges(){const box=$('#badges');box.replaceChildren();
  for (const {title,url,markdown} of markdownBadges()) {
    const item=document.createElement('div');item.className='badge-item';
    const left=document.createElement('div');const label=document.createElement('span');label.textContent=title;
    const img=document.createElement('img');img.src=url;img.alt=title;
    left.append(label,img);const button=document.createElement('button');button.textContent='Copy MD';
    button.addEventListener('click',()=>copyText(markdown,button));item.append(left,button);box.append(item);
  }
}
$('#badge-options').addEventListener('toggle', event => {
  if (event.target.open && current && !$('#badges').children.length) renderBadges();
});
function downloadBlob(content, filename, type) {
  const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function safeName(name){return name.replace(/[^\w.-]+/g,'-').slice(0,100) || 'repository';}
$('#download-json').addEventListener('click',()=>{
  if(!current)return;
  downloadBlob(JSON.stringify(current,null,2),`${safeName(current.title)}-tokei.json`,'application/json');
});
$('#download-csv').addEventListener('click',()=>{
  if(!current)return;
  const records=[['Language','File','Code','Comments','Blanks','Total']];
  for(const [name,stat] of languageEntries()){
    for(const report of stat.reports) records.push([name,report.name,report.stats.code,report.stats.comments,report.stats.blanks,lineTotal(report.stats)]);
  }
  const csv=records.map(row=>row.map(value=>{
    const text = typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? `'${value}` : String(value);
    return `"${text.replace(/"/g,'""')}"`;
  }).join(',')).join('\r\n');
  downloadBlob('\ufeff'+csv,`${safeName(current.title)}-files.csv`,'text/csv;charset=utf-8');
});

// Bookmarkable links work on project pages: https://owner.github.io/project/?repo=owner/repository
const initialRepo = new URLSearchParams(location.search).get('repo');
if(initialRepo){$('#repo-url').value=initialRepo;run({type:'github',url:initialRepo});}
