# Planet 現時点の統合版

## 日本語の起動・適用手順

Planet_Working_Baseline_2026-10-13.zip は単独で起動できるソース一式です。
別のチェックアウトは不要です。Node.js 22 以上を用意し、展開した
planet-source フォルダーで次の順に実行します。

    python3 verify_bundle.py
    npm run build
    npm start -- --no-open

通常は http://127.0.0.1:3000/src/globe/index.html?terrain=shape-first を開きます。
別のポートが表示された場合は、そのポート番号に変更してください。
WebGL2 が使えない場合は npm start -- --no-open --software を実行し、
表示された URL の末尾に &terrain=shape-first を付けてください。

実装済みの内容、残る制限、今後の段階は docs/WORKING_BASELINE_ROADMAP.md を
参照してください。最終検証は VERIFICATION.json と QA レポートに記録しています。

Overlay ZIP は差分だけで、完全なチェックアウトではありません。適用時は
記録されたベースの完全なリポジトリへ PUBLICATION-MANIFEST.json のパスだけを
コピーし、その他のファイルは削除しないでください。省略された過去の609ファイル
は保持対象です。GitHub のブランチは更新されていません。ZIP は保存用です。

# Planet terrain verified source backup

Repository: sanadaei/planet
Branch: work/research-led-relief-20261011
Draft PR: https://github.com/sanadaei/planet/pull/8
Base commit: 43d0afaa9e18aff36ca8605cc77ab3881f59276b

## Run the full source archive
Extract Planet_Working_Baseline_2026-10-13.zip, then enter planet-source.
Install Node.js 22 or newer from its official distribution. This project has no
third-party runtime dependencies; npm install is not required.
Run: python3 verify_bundle.py
Run: npm run build
Run: npm start -- --no-open
Open the localhost URL printed by the server. If WebGL2 is unavailable, run:
npm start -- --no-open --software
Stop the server with Ctrl+C. No baseline checkout is needed to start this archive.
The bundled generated default world is included. Local saved/generated seeds can
be created by the app, but prior machine-local saved seeds are not in this archive.

## Contents and scope
SOURCE-MANIFEST.json hashes every included repository file. PUBLICATION-MANIFEST.json
lists only new/changed files against the base. INHERITED-HISTORICAL-FILES.json lists
609 historical assets intentionally omitted from the working source snapshot;
they are not deletions. Historical scripts referring specifically to those assets
may require a complete checkout or regeneration. Current runtime source, default
world, tests, current research evidence, documentation, and app QA captures are included.
See docs/SHAPE_FIRST_REGION.md, the shape-first experiment documentation, and
reports/shape-first-end-to-end-qa for the implemented behavior and limitations.
VERIFICATION.json records final checks and any remaining limits. Physical channel
shapes and synthetic water budgets are not a claim of calibrated real hydraulics.

## Apply the changes-only archive safely
Extract Planet_Working_Baseline_Overlay_2026-10-13.zip into a separate directory.
Run: python3 verify_bundle.py
Use a clean, complete checkout at the base commit. If the branch has moved,
reconcile deliberately on a recovery branch; never overwrite newer work.
Copy ONLY paths in PUBLICATION-MANIFEST.json, retaining layout and modes. Leave
all unlisted repository files intact, particularly the 609 historical assets.
Bundle metadata files are not repository changes and should not be copied in.
Run the bundle verifier against the checkout:
python3 verify_bundle.py /path/to/checkout PUBLICATION-MANIFEST.json
Review git diff --check and git status. Run npm test and npm run build, plus
applicable focused experiment tests described in the verification evidence.
Only stage reviewed manifest-listed changes. Never use mirror/delete copying.

## Publication state
These ZIPs are backups, not a GitHub publication. Prior uploads created some
unreferenced blobs but no tree, commit, or branch update. GitHub publication is
paused after a cancelled write and has not been retried. No merge or remote CI
success is claimed. Any later authorized publication must preserve newer remote
changes, use ordinary fast-forward updates, and retain PR #8 as draft.
