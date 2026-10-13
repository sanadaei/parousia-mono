> 2026-10-14: **地形の土台を `terrain/` に新しく作り直しています。** 縮尺ごとに別の作り方をする方式をやめ、惑星から近景まで、同じ隆起・侵食過程と親子の低域固定でつなぎます。村・町・道路はこの地形の上に段階T4として載せ直します。既存の `src/` は参考として凍結します。[地形コアのロードマップ](terrain/ROADMAP.md)・[引き継ぎ](terrain/HANDOFF.md)

> 2026-10-13 訂正: **L1候補から局地地形への接続・予算・保存を試す診断例**を追加しました。画面の直交する住宅配置と矩形農地は仮配置で、村の景観として未採用です。`npm run l2:diagnose-layout`で再現できます。次は既存の地形・村のリアリティ方針に照らした比較と配置設計で、その受け入れを経てから全球へ統合します。[範囲と採用条件](docs/L2_SETTLEMENT_MATERIALIZATION.md)。

> 開発・利用環境は **PC** を前提とします。操作・画面・性能の受け入れ条件もPCを対象にします。

> 2026-10-13: **集落規模を整え、L1からL2へ地域候補を渡す段階**まで進めました。`npm run l2:baseline` で[集落候補と農地の見積もり](reports/l2-settlement-baseline/review.html)を作れます。町・都市の最小規模、固定IDの候補ページ、必要耕地面積、広域地形による選別と確定保存を接続しています。候補の敷地・農地・道路は次の段階です。[仕様と再現手順](docs/L2_SETTLEMENT_HANDOFF.md)。

> 前段: **L0の全球人口・集落分布からL1への予算受け渡し**。`npm run l0:baseline` で人口正本・L0/L1 JSONと[全球の分布確認画面](reports/l0-settlement-baseline/review.html)を作れます。人口と村・町・都市の7項目を保存し、適地のない分は未配分として保持します。通常の気候付き惑星生成・世界保存にも同じL0分布を接続しています。[仕様](docs/L0_REVIEW.md)。

> 2026-10-13: 当面の目標は、**今までのベストを組み合わせ、「それらしい」見た目で動く一式を先に仕上げること**です。現在の採用案・仕上げの完了条件・次の順序は [作業用ベースラインのロードマップ](docs/WORKING_BASELINE_ROADMAP.md) を参照してください。形状優先の地形・水系は `/src/globe/index.html?terrain=shape-first`、操作と保存は [実行ガイド](docs/SHAPE_FIRST_REGION.md)。以下の日時付き記録は各時点の履歴です。

> 2026-10-12: 現在の階層は **L0（惑星の下絵）→ L1（新設した広域の具体化）→ L2（従来の地域詳細）** です。[役割と実装範囲](docs/WORLD_LAYER_ROLES.md)。128×64→256×128→512×256の比較と凡例付きHTMLを生成でき、保存したL1の標高・投影気候をL2が利用できます。新しい水系接続試作ではL1の本流・流入量・流出先をL2へ渡し、谷・支流を生成して保存できます。独立した隣接地形・湖・海岸への接続と既存全球UIへの全面採用は未完成です。以下の古い進捗ログや文書名のL1は旧称の場合があります。

> 2026-10-11 05:06 UTC: 882 tests PASS / 0 fail、build成功（115.6秒、256 MiB）。町の教会を固定の一地点だけで諦めず、街路・市場・傾斜に合わせて敷地と建物寸法を調査する方式へ。実町では69戸を維持して礼拝所・塔・敷地・接続路を配置。全景観は引き続き未完成です。

> 2026-10-11 04:52 UTC: 880 tests PASS / 0 fail、build成功（123.0秒、256 MiB）。新規の町では各家の最低限の菜園を先に確保してから、所有街区内の使える奥行きへ拡張。実町7区画で650戸と道路・地盤を維持し、菜園面積38,304→57,056 m²。土壌・収穫・街並み全体の完成は意味しません。

> 2026-10-11 04:39 UTC: 876 tests PASS / 0 fail、build成功。実画面で「読込中」が表示予算による細部不足を隠していたため、両方を明示。植生を含む形状チャンク数を町の区画数として数えていた表示も修正。景観・読み込み時間の完成とは扱いません。

> 2026-10-11 04:29 UTC: 875 tests PASS / 0 fail、build成功（122.8秒、256 MiB）。新規世界の町の外周で、区画の境界を使わず四角く広く残していた更地を修正。大きな実町の全7区画と新規の小世界を別々に検証。20 mの保守的な外縁を残し、町の歴史・全景観の完成は主張しません。

> 2026-10-11 04:13 UTC: 871 tests PASS / 0 fail、build成功（131.8秒、256 MiB）。地面側の道路表示も保存された土道の材質を参照するよう修正。実道路タイルで地形・形状・照会回数は不変。山稜の別試作は見た目が不十分だったため採用せず、記録のみ残しています。全景観は未完成です。

> 2026-10-11 03:57 UTC: 869 tests PASS / 0 fail、build成功（120.9秒、256 MiB）。新規世界の町の区画候補で横・縦の値が連動する偏りを修正。実町の全7区画で650/650戸と中心施設への接続を確認。町の歴史的な成長・全景観は未完成です。

> 2026-10-11 03:48 UTC: 867 tests PASS / 0 fail、build成功（122.2秒、256 MiB）。新規世界の住宅への通路を、直角の迂回を強制せず測量済みの直接経路から選択。実村3件で60戸を維持し、通路全体の曲がりを49→15、48→16、31→13に削減。景観・町の形態は未完成です。

> 2026-10-11 03:35 UTC: 863 tests PASS / 0 fail、build成功（119.9秒、256 MiB）。新規世界の小村の出入口を近隣への道路方向へ接続。実村3件・地域道路2件で接続位置を確認。全景観は未完成です。

> 2026-10-11 03:14 UTC: 860 tests PASS / 0 fail、build成功（128.3秒、256 MiB）。「集落の配置理由」がオンデマンド集落・町の任意区画にも接続。広場・礼拝所・池・菜園・施設の理由を同じ配置データから確認できます。全景観は未完成です。

> 2026-10-11 03:03 UTC: 857 tests PASS / 0 fail、build成功（129.2秒、256 MiB）。村の同じ配置の重複生成を抑制。既存8MiB枠内で再利用し、実村2件の再取得は約1ms、内容一致。初回生成・全景観・GPU実機の受入は未完です。

> 2026-10-11 02:55 UTC: 853 tests PASS / 0 fail、build成功（121.9秒、256 MiB）。表示で計測済みの傾斜を土地被覆にも接続。実タイルで地形照会回数・位置を増やさず急斜面の農地色を修正。全景観の完成ではありません。

> 2026-10-11 02:48 UTC: 852 tests PASS / 0 fail、build成功（123.1秒、256 MiB）。近景の地面も村の実際の敷地を参照するよう修正。林・畑と地面の分類の不一致を改善。町・都市の敷地境界、景観と性能の受入は未完成です。

> 2026-10-11 02:42 UTC: 851 tests PASS / 0 fail、build成功（125.4秒、256 MiB）。実測に基づく丘・山への移動を追加。保存済み地形は変更せず、局所高低差と測定範囲を表示します。丸みの強い山地・冷間読み込み・全景観の自然さは未完成です。

> 2026-10-11 02:31 UTC: 848 tests PASS / 0 fail、build成功（121.1秒、256 MiB）。実際の窪みを調べた池と湿草地を追加。実生成19池の有限検査・クラウド実画面を確認。雨季の水位を仮定した部分実装で、景観全体・年間水収支・性能の受入は未完成です。




> 現在は近景の景観・構造を修正中です。全体は未完成。最新の根拠と残件は [LOCAL_LANDSCAPE_PLAN.md](LOCAL_LANDSCAPE_PLAN.md) と [ROADMAP.md](ROADMAP.md) を参照してください。

# Continuous Terrain Adapter 0.4.0

画面には生成版と保存版の区別を表示します。再読込しても古い保存URLは古い世界のままです。
同梱の「世界の例」は旧生成版も含みます。今回の林・農地・広場・住宅・支道・共同貯水池を確認するには「新しい配置を別の惑星で確認する」からseedを指定して生成してください。案内を開くだけでは生成せず、既存の保存世界も変更しません。
「地形メモリ上限」は既定64MiB、省メモリで精度が不足する場合の比較用に128MiBも選べます。
ブラウザ全体はこれより多くのメモリを使います。勝手に上限を上げる処理はありません。


## 現在のクラウド実装

生成済み世界では海・湖・終端湖・全球河川・8集落の家屋と道路/橋を同じ保存から表示します。Windows は `StartPlanet.cmd`、macOS/Linux は `./start-planet.sh`、または `npm start` で起動し、全球画面で集落や湖を選択してください。Node.js 22 以上だけ必要です。起動時のビルド・依存インストール・世界再生成は不要です。ポートが使用中なら次の番号を試します。ブラウザを自動で開かない場合は `npm start -- --no-open`、CPU表示は `npm start -- --software`。Windows のバッチ自体はクラウドLinuxでは実行検証できていません。選択した村の車両通行・雨水排水の画面へも移れます。最新の実装と実入力/出力・制約は [PLANET_WORLD.md](PLANET_WORLD.md)、現行作業は [HANDOFF.md](HANDOFF.md)。水域自動化の旧「保留」は解除されています。

ロードマップ全体は継続中です。物理水文の全領域や、旧形式を含む全河床のC1、PCのGPU実機・性能が完了したという意味ではありません。新規の明示地域河床は [C1ポリシー](PLANAR_C1_BED.md) で利用でき、旧保存は元の値を保持します。雨水画面の中断・再開は [Worker経路](RUNOFF_WORKER.md) を使用します。以下の版ごとの試験数・性能はその時点の履歴です。

生成結果は `examples/planet/generated/worlds/` の不変の世代別データとして保存されます。再生成しても開いている旧世界のページを上書きしません。入口の `manifest.json` が最新世代を指します。旧世代は自動削除しないため、繰り返し生成するとディスク使用量が増えます。

## このリポジトリだけで確認する

- `npm test` と `npm run build`：現在の全試験・構文・入口同一性。
- `npm run verify:planet`：新しい5世界の実生成・保存復元・家屋・道路・水系とページ参照。
- `npm run verify:ground-mesh-errors`：実世界の地盤三角形内部と正本の比較。
- `npm run verify:planet-collectors`：明示した理想集水線の幅と格子間隔による比較。

後述の旧 `verify` / `verify:stage3` 等には隣接する旧素材集のソースが必要です。
それらの来歴検証を省略して合格にはしません。現在の惑星生成・起動・上記の検証には旧素材集は不要です。

## 以前の版の経緯

2026-10-10に基礎地形の誤差を含むLODと階層順の双方向モーフを実装した。全279試験・ビルド・旧40保存再開と120秒の実画面測定を確認。変更・結果・残課題は [GLOBE_LOD_QUALITY.md](GLOBE_LOD_QUALITY.md)、引き継ぎは [HANDOFF.md](HANDOFF.md)。現在は第5段階の全球表示品質・運用・受入が進行中。

有限地域と球面全球について、確定した数値場を任意の地表座標で連続参照する部品。表示間隔・表示窓を変えても、同座標の標高・勾配・水深は同じ。Node 22とブラウザの標準機能を使い、外部パッケージは不要。

0.4.0では **宇宙から地表へ連続ズームする3D Paged Globe** を追加した。`npm run ui` で起動し、`http://127.0.0.1:3000/src/globe/index.html` を開く（旧UIの `3D Globe` からも入れる）。ECEF・Cube-Sphere・WebGL 2、2 Worker、入力ページ/GPUのLRU、親モーフとスカートを実装した。設計とトレードオフは [GLOBE_ARCHITECTURE.md](GLOBE_ARCHITECTURE.md)、数値・fps・メモリの証拠と未達ゲートは [GLOBE_VALIDATION.md](GLOBE_VALIDATION.md)。第5段階の全球表示プロトタイプであり、全品質要件の受入完了とは扱わない。

方針と現在位置は [ROADMAP.md](ROADMAP.md)。第1・2段階の共通参照と静的な明示水系、第3段階の全球/投影・残差詳細化・明示chart間河川と固定細分D8補正、第4段階の道路/建物造成・交差・通行性、第5段階のWeb表示を実装した。第3段階の残課題と第4・5段階の統合検証は進行中。物理水文・構造耐力・実生成地域の自然さ/利用者受入は残る。有限地域は [SURFACE_WATER.md](SURFACE_WATER.md)、全球は [GLOBAL_TERRAIN.md](GLOBAL_TERRAIN.md) と [GLOBAL_WATER.md](GLOBAL_WATER.md)。

0.3.5の補修は [AUDIT_RESPONSE_0.3.4.md](AUDIT_RESPONSE_0.3.4.md)。ルート入口を `src/core` の実体へ統一し、UIの通行性と交差4状態をコアと揃え、保存時の交差/暗渠情報を保持する。全256試験、旧40保存の互換、限定した実画面・保存再開を確認した。水域自動化は利用者の指定で保留。

0.2監査の優先5項目は [AUDIT_RESPONSE.md](AUDIT_RESPONSE.md)。境界開口、凹水域、水位格子の併用、道路交差の接口、重複処理を修正した。監査に列挙された全不足の実装完了とは扱わない。

0.2.1分析への対応は [AUDIT_RESPONSE_0.2.1.md](AUDIT_RESPONSE_0.2.1.md)。共通算術・水深責務を整理し、次数別断面、C1基礎地形、法線/曲率APIを追加した。使用と限界は [REFINEMENT.md](REFINEMENT.md)。水域自動化は利用者の指定で延期。

0.3.0監査への対応は [AUDIT_RESPONSE_0.3.0.md](AUDIT_RESPONSE_0.3.0.md)。C1地域地形に河川・明示水域・表流水格子を接続し、岸の判定と線分極値をC1に対応させた。投影地域の線分参照と道路診断も追加した。0.3.2では全球場を直接参照して明示水系を重ね、中心線掘削量の上限を保存・再検証する。河床全体のC1化と複数chartの全球河川網は後続。

0.3.2分析の優先4項目への対応は [AUDIT_RESPONSE_0.3.2.md](AUDIT_RESPONSE_0.3.2.md)。0.3.3では投影地域の有限格子書き出し、全球水系の二重コンパイル除去、流路方向に沿う境界流出、広域参照予算の適応を追加した。斜め流出口の開口も修正した。書き出しは別worldIdの近似地域版で、APIと出典保持は [PROJECTED_CANONICAL.md](PROJECTED_CANONICAL.md)。

0.3.3分析への対応は [AUDIT_RESPONSE_0.3.3.md](AUDIT_RESPONSE_0.3.3.md)。0.3.4では外岸を滑らかな重みで接続し、同一エッジ内の湿潤自己重複を拒否する。新しい詳細化は元中心を保ちつつ格子線/極域へも成分を残し、明示水系は1世界に最大16の独立chartを保存できる。全河床のC1化は未完。後続の明示chart間河川コアはROADMAPの2026-10-09の記録を参照。

第4段階の道路コアとして、橋面・進入路の縦断線形、中心線の連続標本、切盛土と滑らかな法面を追加した。同座標の直接参照/窓/LOD一致と橋下の水路保持を検証する。API・再構築方法・限界は [ROAD_EARTHWORK.md](ROAD_EARTHWORK.md)。第3段階の残課題は継続し、第4段階全体と第5段階の実画面受入は未完。

現在の構造的問題（重複、偏り、未実装機能、およびGoogle Earth型LOD構想とのギャップ）の包括的分析は [ENGINE_ANALYSIS.md](ENGINE_ANALYSIS.md)。Google Earth型連続LODストリーミングの実装指示書は [SPEC_CONTINUOUS_LOD_STREAMING.md](SPEC_CONTINUOUS_LOD_STREAMING.md)。

## 実行

このフォルダで実行する。外部パッケージのインストールは不要。

```powershell
npm run example
npm test
npm run verify
npm run example:water
npm run verify:water
npm run verify:refinement
npm run example:global
npm run verify:global
npm run verify:global-water
npm run verify:audit
npm run verify:stage3
npm run verify:core-ui
npm run build
npm run ui
npm run globe:package
npm run verify:globe
```

`example` は明示した水位と平面地形の小さい解析例。`node example.mjs new-snapshot.json` は新規ファイルへ保存し、既存ファイルを上書きしない。

`verify` は試験と旧 `dynamic-terrain-runtime` の64×48・180m地域生成1件を直列実行し、`examples/` の本部品専用検証出力を更新する。旧部品は隣接する0.3_Coreフォルダを参照する。子プロセスは256MiB heap・30秒上限。空きメモリ768MiB未満では生成を延期する。基礎APIと保存再読込に旧部品は不要。

`verify:water` は現在の全試験と、従来8ケースにC1の実地域2件を加えた計10ケースを直列で確認する。道路交差とC1河川の表面フレームの別プロセス再構築も照合する。出力は `examples/surface-water/<package-version>/`。`example:water` は生成器を起動しない小さい湖→河川→海の例。

`verify:refinement` は現在の全試験と、実地域2件のC1基礎補間、元格子の保持・標高範囲・導関数・LOD/窓、別プロセスでの表面フレーム保存再開を確認する。出力は `examples/refinement/`。生成は直列、子プロセス256MiB heap・30秒上限。

`verify:global` は現在の全試験と、geography-liteの実入力2件・12地域viewを確認する。元標高/排水、新しい残差詳細化、経度同値・極点、投影、LOD/窓、投影線分/道路、別プロセス保存再開を照合し、パッケージ版ごとの`examples/global/<package-version>/`へ出力する。`example:global`はgenerator不要の小例。任意の出力ファイル名を付ければ、全球場を含む地域snapshotを新規保存できる。

`verify:global-water` は現在の全試験と、保存済みの全球実入力2件の8投影への明示合流graph、人工湖1例を確認する。計9ケースを独立した単一chartとして構築し、別プロセスで水深・法線・流域・道路診断を照合する。既知範囲外は水深null。出力先は `examples/global-water/<package-version>/`。旧ソースと元の全球snapshotのハッシュも確認する。

`verify:audit` は現在の全試験、全球から8地域への格子書き出しと表流水/地下水格子の接続、流出方向を修正した実地域2件の構築・別プロセス保存再開を確認する。旧全球水系9件・全球基礎2件・有限地域水系10件も元のworldIdで再読込し、元ソースと入力snapshotのハッシュを照合する。出力先は `examples/audit-0.3.2/<package-version>/`。版別の検証出力により、従来の版なしフォルダの保存互換資料を保持する。

`verify:stage3` は現在の全試験、実全球2入力から新しい詳細化と各4chartの同時構築、外岸を修正した実地域2件、旧40snapshotの保存互換を確認する。現在の記録は [examples/audit-0.3.3/0.4.0/verification.json](examples/audit-0.3.3/0.4.0/verification.json)。元ソース/入力ハッシュを照合し、子プロセス256MiB heap・30秒上限・直列で実行する。

`globe:package` は同梱デモの入力ページを再生成する。`--snapshot` と `--out` を指定すると既存の基礎全球/明示水系snapshotを変換できる。`verify:globe` は数値回帰・ページSHA・ビルドと、保存した実ブラウザ記録のCore照合を行う。最新のブラウザ測定が必要で、古い記録だけでは合格にしない。実行手順・記録・未達ゲートは [GLOBE_VALIDATION.md](GLOBE_VALIDATION.md)。

## API

```js
import { createTerrainAdapter, serializeTerrain, restoreTerrain, TERRAIN_SCHEMA } from './index.mjs';

const terrain = createTerrainAdapter({
  schema: TERRAIN_SCHEMA,
  seed: 'world-1', revision: 'my-source@1',
  frame: { kind: 'planar-metric', originXM: 0, originYM: 0, verticalDatum: 'my-world-zero' },
  grid: { columns: 2, rows: 2, cellSizeM: 100, sampleLocation: 'cell-center' },
  derivativeStepM: 1,
  fields: {
    groundElevationM: [10, 20, 30, 40],
    waterLevelElevationM: [25, 25, 25, 25],
  },
  references: {},
});

const point = terrain.sampleAt(80.25, 95.5);
const window = terrain.sampleWindow({
  minXM: 50, minYM: 50, maxXM: 150, maxYM: 150, spacingM: 10,
});
const reopened = restoreTerrain(serializeTerrain(terrain));
```

- **入力場:** 行優先のArrayまたはTypedArray。各場はcolumns×rows個の有限値。groundElevationMは陸面または水底。水位が分からない場合はwaterLevelElevationMをnullにする。標高基準名は必須で、別の世界の標高を無条件に混ぜない。
- **座標と範囲:** セル中心 `(originX + (x+.5)*cellSize, originY + (y+.5)*cellSize)` に値を置く。範囲は原点からcolumns/rows×cellSizeまで、境界を含む。最外セル中心から外周までの半セルは一定値で延長する。範囲外はエラー。
- **連続参照:** 双線形補間。勾配は固定のderivativeStepMで世界全体を差分し、領域端は利用できる距離を使う。窓端で差分範囲や正規化を変えない。
- **sampleAt:** worldId、座標、groundElevationM、gradient、slopeMPerM、水の状態と値を返す。水位未提供はhydrologyStatus=`unresolved`・水深null。水位提供時は`defined`で、水深が正の地点だけにwaterSurfaceElevationMがある。乾いた地点の水深は0、水面はnull。
- **surfaceFrameAt:** sampleAtの値に上向き単位法線と固定距離の曲率推定を追加する。対称差分が領域外へ出る場合は曲率null。C1の基礎地形と次数別の河道はREFINEMENT.md。
- **sampleWindow:** 幅/高さはspacingMの整数倍。窓の四辺を含む頂点を行優先で返す。共通境界は同じ座標。生成器の再実行・窓単位の正規化・水域タグの後付けは行わない。
- **上限:** canonical格子は1,048,576標本、1窓は262,144標本。これは入力上限であり、その規模の性能合格を意味しない。
- **保存と同一性:** toSnapshotは独立したコピー、serializeTerrainはJSON文字列。worldIdは場・座標・基準・seed・生成版・参照地物のSHA-256。保存内容が変わりIDと一致しなければ再読込を拒否する。暗号署名や出典の真正性を保証する仕組みではない。

第2段階では同じAPIに静的な河道modelを追加した。hydrologyStatus=`modeled`と流域情報を返す。新規地形snapshotは@2で、旧@1の読み込みも維持する。河道modelは@2に更新し、旧水系@1も元の識別子と挙動で読める。水位格子との併用ではwaterLevelRoleをsurfaceまたはgroundwaterと明示する。groundElevationAtは勾配/水域情報を作らない地表参照、traceSurfaceSegmentは道路診断用の線分参照。道路交差の使用と精度はSURFACE_WATER.md。

## 旧地域worldの読み込み

```js
import { fromDynamicRegional } from './dynamic-regional.mjs';

// world は既存の generateRegional が返した、生成済みの地域。
const terrain = fromDynamicRegional(world, {
  verticalDatum: 'dynamic-runtime-unspecified-local-zero',
});
const wilderness = terrain.sampleAt(270, 270);
```

アダプタ自身はgenerateRegional/generateMicroを呼ばない。元の地域標高場をコピーし、集落・道路・河川graphのIDとメートル位置を `toSnapshot().references` に保持する。旧生成器の標高基準は物理的に確定していないため、上例ではその不明な局地基準を明示している。

旧worldの水域maskやriverGraphだけでは水面標高が決まらない。この基礎入口の既定の水深はnullで、川の地点を乾いた土地として確定しない。外部で構築済みの全域水位場は `waterLevelElevationM` オプションで渡せる。今回追加した `fromDynamicRegionalWater` を使うと、元の一次流向に沿った地域水系と静的な河床/水面を別の世界版として構築する。

この入口は旧Microのnoise・河床・建物配置を再現するものではない。旧sourceファイルと0.3素材集の出典管理・カタログは変更していない。

## 第1段階で確認した結果

検証出力は [examples/verification.json](examples/verification.json)。解析例と異常入力等の単体試験、実入力、別プロセス保存再開を区別して記録した。

- 単体試験: 12件PASS。解析的な標高/勾配/水位/水深、LOD/窓の一致、任意座標、C0境界、変更隔離、保存、異常入力を確認。
- 実入力: seed=`world-a`、64×48・180m、11.52km×8.64km。180m/60m表示の共通49地点と、隣接窓の境界19地点が全sample値で一致。
- 元の標高sampler: 内部49地点の差が1e-9m未満。最終セルの中心と外周では、本部品の正確な最終値と明示した一定値延長を使う。
- 集落外: 最寄り集落から約3,997m離れた(270m,270m)を参照できた。
- 保存再開: generatorを読み込まない別プロセスで54地点が全sample値で一致。
- 参照地物: 4集落、5道路、河川27node/13edgeのIDを維持。位置変換は単体試験でも確認。
- 元ソース: 2ファイルのSHA-256がPROVENANCEおよび試験前後で一致。

第2段階と監査補修の結果はSURFACE_WATER.md、AUDIT_RESPONSE.md、AUDIT_RESPONSE_0.2.1.mdに記録した。一律断面の実地域2件で28合流点・16,616参照点の水位逆転/水深違反0、14道路の27交差候補を確認。次数別2件も28合流点・16,616点で違反0。全8表流水ケースの保存再読込1,737地点と道路診断、C1実地域2件の306表面フレームが一致した。

単体試験は現在107件PASS。0.3.4の実全球2世界で元2,304中心を保持し、各4chartを同時に構築した。計4,144中心線参照点で水位逆転/水深違反0、672表面フレームを別プロセスで照合した。外岸を修正した実地域2件は28合流・16,740参照点で違反0、27出口の81開口地点が濡れており、764地点・98表面フレームと道路診断が再読込で一致。旧40snapshotの元worldId/値、元ソース8ファイルのハッシュも維持した。新規geography-lite読み込みの2世界・12viewの検証は [examples/global/0.3.4/verification.json](examples/global/0.3.4/verification.json)。

第3段階全体は進行中。chartを跨ぐ河川/重複範囲の水際、全河床のC1化、実測微地形、建物接地、描画・自然さ、全seedや既存素材の全試験は未検証。細かい間隔の補間は同じ間隔の情報を増やさず、今回の追加補正も実測情報ではない。


## 複数の生成世界を見る

`npm start` で開く全球画面の「世界の例」から、標準世界、別地形A/B、低水位の終端湖、海面下の閉鎖流域を選べます。湖や集落を選ぶと、その同じ保存世界の地点へ移動します。未接続河川がある世界は画面にも件数を表示します。

5例を再生成する開発用コマンドは `npm run planet:examples`。単独生成は `npm run planet:generate -- my-seed examples/planet/custom --lake-fill=0.6`。湖水位の充填率は明示した生成条件で、気候計算の結果ではありません。起動だけなら再生成は不要です。

### 明示した排水条件から管径を選ぶ

`npm run verify:culvert-design` は設計流量0.06m³/s、安全係数1.2、入口上0.6m/出口上0.1mの水位を明示した1集落世界を保存し、径候補0.2/0.3/0.4/0.6/0.8/1mから条件を満たす最小径を選びます。雨50mm/時は、その後600秒の動作検証条件であり、設計流量を算出した根拠ではありません。

起動中の画面のURLを `/src/globe/index.html?world=/examples/planet/culvert-design/manifest.json` にするとこの保存を開けます。「雨と排水」へ進むと、選択径と設計入力は「計算条件と限界」に表示され、保存された同じ管を計算に使います。候補径が足りない場合は生成エラーで知らせ、勝手に条件を緩めません。既定の5世界は従来の明示0.4m径を保持します。

APIは `generatePlanet({ culvertDesign: { diametersM, safetyFactor, headCases: [{ id, targetFlowM3PerSecond, upstreamDepthM, downstreamDepthM }] } })`。現状はゲーム用準定常近似の容量選定で、流域の設計豪雨推定・背水曲線・実測校正・実際の土木設計の保証ではありません。

生成版11は1800m・120m・8mの詳細化を、描画と物理参照が共有する地表へ保存します。既定の生成作業上限は32,768粗セル・32,768河川点です。表示のズームだけなら粗格子を増やす必要はありません。`maxSourceCells` / `maxRiverPoints` を明示して上限を増やせますが、256MiBのNodeで512×256を連続生成する試験はメモリ不足となったため、その設定は既定では拒否します。

集水範囲と暗渠候補の実入力・不一致の扱い: [CATCHMENT_FLOW.md](CATCHMENT_FLOW.md)。雨水画面から実行・中断可能。
