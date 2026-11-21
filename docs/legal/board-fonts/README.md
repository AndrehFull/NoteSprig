# Board font provenance

The drawing engine is pinned to `@excalidraw/excalidraw` 0.18.1. Its font assets have separate author licenses. [The reviewed inventory](../board-fonts.json) records SHA-256 checksums for all 234 distributed WOFF2 files, embedded font-name notices, complete license texts, and pinned upstream evidence.

| Family | License | Complete notice |
| --- | --- | --- |
| Assistant | SIL Open Font License 1.1 | [Assistant](Assistant-LICENSE.txt) |
| Cascadia Code | SIL Open Font License 1.1; embedded notice retained | [Cascadia](Cascadia-LICENSE.txt) |
| Comic Shanns | MIT | [Comic Shanns](ComicShanns-LICENSE.txt) |
| Excalifont | SIL Open Font License 1.1 | [Excalifont](Excalifont-LICENSE.txt) |
| Liberation Sans 1.05 | GPL version 2 with the Liberation font exceptions | [Liberation](Liberation-LICENSE.txt) |
| Lilita One | SIL Open Font License 1.1 | [Lilita](Lilita-LICENSE.txt) |
| Nunito | SIL Open Font License 1.1 | [Nunito](Nunito-LICENSE.txt) |
| Virgil | SIL Open Font License 1.1 | [Virgil](Virgil-LICENSE.txt) |
| Xiaolai SC | SIL Open Font License 1.1 | [Xiaolai](Xiaolai-LICENSE.txt) |

The Excalifont license comes from the complete generated font-name comment in the [pinned upstream source](Excalifont-upstream-index.ts). Comic Shanns includes the full MIT text and all five copyright notices in its embedded nameID 0. Cascadia's complete embedded nameID 13 notice is retained alongside the v2005.15 upstream license. Virgil includes its embedded notice and the upstream Ellinor Rapp attribution. Xiaolai includes the version-matched upstream license, the embedded LXGW attribution, and the later upstream notice crediting Nozomi Seto.

## Liberation source availability

The bundled Liberation font identifies itself as **Version 1.05**, with a FontForge identifier dated January 12, 2009. Its source is provided here with its original build script, Makefile, authors, changelog, GPL text, and license exceptions:

- [LiberationSans-Regular.sfd](Liberation/source/src/LiberationSans-Regular.sfd)
- [FontForge build script](Liberation/source/scripts/sfd2ttf.pe)
- [Original Makefile](Liberation/source/Makefile)
- [GPL version 2](Liberation/source/COPYING)
- [Liberation license and exceptions](Liberation/source/License.txt)
- [Complete upstream source archive at the pinned commit](https://github.com/liberationfonts/liberation-1.7-fonts/archive/99a390676af7be27fcb477c6636dd5106290dda4.tar.gz)

The pinned source matches all 675 glyph names and all 675 advance widths in the distributed font. A bit-identical build with the historical FontForge version has not been asserted. The font bytes copied from the pinned engine package remain unchanged.

## Verification

Run `node scripts/acquire-board-licenses.mjs --check` after installing dependencies. This verifies the engine version, every font checksum, every complete notice, and the stored upstream sources. `--fetch` reacquires the checksum-locked upstream evidence and source files, then runs the same verification. Normal builds can check the committed evidence without network access or a Python installation.

Any engine or font update requires reviewing this inventory and preserving the accompanying author licenses and Liberation source in redistributed assets.
