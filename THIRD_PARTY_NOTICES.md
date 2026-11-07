# Third-party notices

NoteSprig's original code and documentation use MIT. The components below retain their own licenses and copyright notices. This index conservatively includes every locked runtime dependency, including dependencies of the frontend and the production server; some may not appear in a particular tree-shaken build. Development tools and the container base operating system are outside this npm inventory.

Generated from both committed lockfiles and the installed package license files. Regenerate with `npm run notices:generate`; verify with `npm run notices:check`. No timestamps or machine-specific paths are included.

Full upstream license and notice texts are preserved in [THIRD_PARTY_LICENSES.txt](docs/legal/THIRD_PARTY_LICENSES.txt). Machine-readable package versions, repository metadata, and source archive URLs are in [runtime-dependencies.json](docs/legal/runtime-dependencies.json). Compiled builds also include the licenses under `/legal/`.

## Components requiring particular attention

- **elkjs** is licensed under EPL-2.0 and is a transitive Mermaid dependency. The locked version's source is [kieler/elkjs 0.9.3](https://github.com/kieler/elkjs/tree/0.9.3), with the underlying Java layout implementation in [Eclipse ELK](https://github.com/eclipse-elk/elk). Preserve its license and source availability information when distributing it; an MIT license on this project does not relicense elkjs.
- **DOMPurify** is offered under `MPL-2.0 OR Apache-2.0`. Both license texts supplied by the package are retained.
- **KaTeX** includes the mathematical fonts used by the interface. Its supplied license text is retained with the package's notices.
- **khroma** omits a license field in its published package metadata. Its included `license` file explicitly states MIT and is used as the inventory source.

The distributed npm components are not patched by NoteSprig; bundling and minification do not change their license ownership. If you modify or redistribute a component, review its applicable source and notice requirements. Container images additionally contain Node.js and Debian packages with their own licenses and notices.

## Locked runtime packages (151)

| Package | Version | License |
| --- | --- | --- |
| `@antfu/install-pkg` | 2.1.0 | MIT |
| `@braintree/sanitize-url` | 7.1.2 | MIT |
| `@chevrotain/cst-dts-gen` | 13.2.0 | Apache-2.0 |
| `@chevrotain/gast` | 13.2.0 | Apache-2.0 |
| `@chevrotain/regexp-to-ast` | 13.2.0 | Apache-2.0 |
| `@chevrotain/types` | 13.2.0 | Apache-2.0 |
| `@chevrotain/utils` | 13.2.0 | Apache-2.0 |
| `@codemirror/autocomplete` | 6.20.4 | MIT |
| `@codemirror/commands` | 6.11.1 | MIT |
| `@codemirror/lang-css` | 6.3.1 | MIT |
| `@codemirror/lang-html` | 6.4.12 | MIT |
| `@codemirror/lang-javascript` | 6.2.5 | MIT |
| `@codemirror/lang-markdown` | 6.5.2 | MIT |
| `@codemirror/language` | 6.13.1 | MIT |
| `@codemirror/lint` | 6.9.7 | MIT |
| `@codemirror/search` | 6.7.2 | MIT |
| `@codemirror/state` | 6.7.6 | MIT |
| `@codemirror/streamparser` | 6.0.0 | MIT |
| `@codemirror/view` | 6.43.15 | MIT |
| `@iconify/types` | 2.0.0 | MIT |
| `@iconify/utils` | 3.1.7 | MIT |
| `@lezer/common` | 1.5.5 | MIT |
| `@lezer/css` | 1.3.9 | MIT |
| `@lezer/highlight` | 1.2.5 | MIT |
| `@lezer/html` | 1.3.13 | MIT |
| `@lezer/javascript` | 1.5.6 | MIT |
| `@lezer/lr` | 1.4.12 | MIT |
| `@lezer/markdown` | 1.8.1 | MIT |
| `@marijn/find-cluster-break` | 1.0.4 | MIT |
| `@mermaid-js/parser` | 2.0.1 | MIT |
| `@types/d3-array` | 3.2.2 | MIT |
| `@types/d3-axis` | 3.0.6 | MIT |
| `@types/d3-brush` | 3.0.6 | MIT |
| `@types/d3-chord` | 3.0.6 | MIT |
| `@types/d3-color` | 3.1.3 | MIT |
| `@types/d3-contour` | 3.0.6 | MIT |
| `@types/d3-delaunay` | 6.0.4 | MIT |
| `@types/d3-dispatch` | 3.0.7 | MIT |
| `@types/d3-drag` | 3.0.7 | MIT |
| `@types/d3-dsv` | 3.0.7 | MIT |
| `@types/d3-ease` | 3.0.2 | MIT |
| `@types/d3-fetch` | 3.0.7 | MIT |
| `@types/d3-force` | 3.0.10 | MIT |
| `@types/d3-format` | 3.0.4 | MIT |
| `@types/d3-geo` | 3.1.1 | MIT |
| `@types/d3-hierarchy` | 3.1.7 | MIT |
| `@types/d3-interpolate` | 3.0.4 | MIT |
| `@types/d3-path` | 3.1.1 | MIT |
| `@types/d3-polygon` | 3.0.2 | MIT |
| `@types/d3-quadtree` | 3.0.6 | MIT |
| `@types/d3-random` | 3.0.4 | MIT |
| `@types/d3-scale-chromatic` | 3.1.0 | MIT |
| `@types/d3-scale` | 4.0.9 | MIT |
| `@types/d3-selection` | 3.0.12 | MIT |
| `@types/d3-shape` | 3.2.0 | MIT |
| `@types/d3-time-format` | 4.0.3 | MIT |
| `@types/d3-time` | 3.0.4 | MIT |
| `@types/d3-timer` | 3.0.2 | MIT |
| `@types/d3-transition` | 3.0.9 | MIT |
| `@types/d3-zoom` | 3.0.9 | MIT |
| `@types/d3` | 7.4.3 | MIT |
| `@types/geojson` | 7946.0.16 | MIT |
| `@types/trusted-types` | 2.0.7 | MIT |
| `@upsetjs/venn.js` | 2.0.0 | MIT |
| `chevrotain` | 13.2.0 | Apache-2.0 |
| `codemirror` | 6.0.2 | MIT |
| `commander` | 15.0.0 | MIT |
| `commander` | 7.2.0 | MIT |
| `cose-base` | 1.0.3 | MIT |
| `cose-base` | 2.2.0 | MIT |
| `crelt` | 1.0.7 | MIT |
| `cytoscape-cose-bilkent` | 4.1.0 | MIT |
| `cytoscape-fcose` | 2.2.0 | MIT |
| `cytoscape` | 3.34.4 | MIT |
| `d3-array` | 2.12.1 | BSD-3-Clause |
| `d3-array` | 3.2.4 | ISC |
| `d3-axis` | 3.0.0 | ISC |
| `d3-brush` | 3.0.0 | ISC |
| `d3-chord` | 3.0.1 | ISC |
| `d3-color` | 3.1.0 | ISC |
| `d3-contour` | 4.0.2 | ISC |
| `d3-delaunay` | 6.0.4 | ISC |
| `d3-dispatch` | 3.0.1 | ISC |
| `d3-drag` | 3.0.0 | ISC |
| `d3-dsv` | 3.0.1 | ISC |
| `d3-ease` | 3.0.1 | BSD-3-Clause |
| `d3-fetch` | 3.0.1 | ISC |
| `d3-force` | 3.0.0 | ISC |
| `d3-format` | 3.1.2 | ISC |
| `d3-geo` | 3.1.1 | ISC |
| `d3-hierarchy` | 3.1.2 | ISC |
| `d3-interpolate` | 3.0.1 | ISC |
| `d3-path` | 1.0.9 | BSD-3-Clause |
| `d3-path` | 3.1.0 | ISC |
| `d3-polygon` | 3.0.1 | ISC |
| `d3-quadtree` | 3.0.1 | ISC |
| `d3-random` | 3.0.1 | ISC |
| `d3-sankey` | 0.12.3 | BSD-3-Clause |
| `d3-scale-chromatic` | 3.1.0 | ISC |
| `d3-scale` | 4.0.2 | ISC |
| `d3-selection` | 3.0.0 | ISC |
| `d3-shape` | 1.3.7 | BSD-3-Clause |
| `d3-shape` | 3.2.0 | ISC |
| `d3-time-format` | 4.1.0 | ISC |
| `d3-time` | 3.1.0 | ISC |
| `d3-timer` | 3.0.1 | ISC |
| `d3-transition` | 3.0.1 | ISC |
| `d3-zoom` | 3.0.0 | ISC |
| `d3` | 7.9.0 | ISC |
| `dagre-d3-es` | 7.0.14 | MIT |
| `dayjs` | 1.11.23 | MIT |
| `delaunator` | 5.1.0 | ISC |
| `dompurify` | 3.4.17 | (MPL-2.0 OR Apache-2.0) |
| `elkjs` | 0.9.3 | EPL-2.0 |
| `es-toolkit` | 1.53.1 | MIT |
| `fflate` | 0.8.3 | MIT |
| `hachure-fill` | 0.5.2 | MIT |
| `highlight.js` | 11.12.0 | BSD-3-Clause |
| `iconv-lite` | 0.6.3 | MIT |
| `import-meta-resolve` | 4.2.0 | MIT |
| `internmap` | 1.0.1 | ISC |
| `internmap` | 2.0.3 | ISC |
| `jsep` | 1.6.0 | MIT |
| `katex` | 0.18.10 | MIT |
| `katex` | 0.19.1 | MIT |
| `khroma` | 2.1.0 | MIT |
| `layout-base` | 1.0.2 | MIT |
| `layout-base` | 2.0.1 | MIT |
| `lodash-es` | 4.18.1 | MIT |
| `lucide-react` | 0.468.0 | ISC |
| `marked` | 16.4.2 | MIT |
| `marked` | 17.0.6 | MIT |
| `mermaid` | 12.2.0 | MIT |
| `package-manager-detector` | 1.9.0 | MIT |
| `path-data-parser` | 0.1.0 | MIT |
| `points-on-curve` | 0.2.0 | MIT |
| `points-on-path` | 0.2.1 | MIT |
| `react-dom` | 19.3.1 | MIT |
| `react` | 19.3.1 | MIT |
| `robust-predicates` | 3.0.3 | Unlicense |
| `roughjs` | 4.6.6 | MIT |
| `rw` | 1.3.3 | BSD-3-Clause |
| `safer-buffer` | 2.1.2 | MIT |
| `scheduler` | 0.28.0 | MIT |
| `style-mod` | 4.1.4 | MIT |
| `stylis` | 4.4.0 | MIT |
| `tinyexec` | 1.3.1 | MIT |
| `ts-dedent` | 2.3.0 | MIT |
| `uuid` | 14.0.3 | MIT |
| `w3c-keyname` | 2.2.8 | MIT |
| `yaml` | 2.9.1 | ISC |
