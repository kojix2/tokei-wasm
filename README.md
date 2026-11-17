# tokei / wasm

Count code, comments, and blank lines with Rust tokei 15.0.0 compiled to WebAssembly. Runs in the browser without an application server, account, or database.

| Application | Inputs | Build output |
| --- | --- | --- |
| Web app | Public GitHub repositories, local files and folders | `dist/web/` |
| Chrome / Firefox extensions | Public repositories on supported Git hosts | `dist/chrome/`, `dist/firefox/` |

## Run

Requires Node 22+. The compiled Wasm is included; npm dependencies and Rust are not required to run or assemble the apps.

```sh
npm start
```

Open http://127.0.0.1:8000. Enter a GitHub URL or `owner/repository`, or select or drop local files. A `?repo=owner/repository` URL starts analysis automatically.

Results include language and file counts, charts, search, sorting, and JSON/CSV exports. Local source contents stay in the browser. Hosted analysis uses a single commit for downloads and source links.

## Build

```sh
npm run build
npm run package:extensions
```

The first command assembles all apps. The second creates extension ZIPs in `dist/` and requires `zip`. Load `dist/chrome/` as an unpacked Chrome extension or `dist/firefox/manifest.json` as a temporary Firefox add-on. See the [extension guide](docs/extensions.md) for supported hosts, permissions, and installation limits.

## Documentation

- [Development: commands, tests, and GitHub Pages](docs/development.md)
- [Extensions: installation and supported hosts](docs/extensions.md)
- [Architecture: source layout, data flow, and analysis limits](docs/architecture.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE). Distributions include the upstream tokei and vendored home licenses.
