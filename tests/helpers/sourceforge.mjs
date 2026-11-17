export function sourceforgeHTML(entries) {
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  return `<html><table><thead><tr><th>File</th><th>Date</th><th>Author</th><th>Commit</th></tr></thead><tbody>${entries.map(([name, folder = false]) =>
    `<tr><td><a class="icon" href="${escape(name)}"><i class="fa ${folder ? 'fa-folder' : 'fa-file-o'}"></i>${escape(name)}</a></td></tr>`).join('')}</tbody></table></html>`;
}
