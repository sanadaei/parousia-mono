# L2: 地域のまとまりと水系から詳細へ

2026-10-12。旧L1はL2へ改称。新しいL1はL0とL2の間の広域具体化層。
この文書の過去の記録にあるL1は旧称で、完成報告ではない。既存リンクを保つためファイル名は維持する。

## 何を作るか

大陸全体の平均的な地形・気候から、山地、丘陵、平野、流域、湿潤域・乾燥域の配置を具体化する。
集落を置く前に、そこへ水がどこから来てどこへ去るか、谷と分水界がどこにあるかを決める。
固定の2/20/200km枠は導入しない。処理対象の広さは流域・地形・利用可能な計算量に従う。

## 役割の違う三つの区切り

- 生成の対象: 主に流域・支流域。小さな沿岸流域はまとめて処理できる。まとめても河口は別々に残す。
- 地形・植生のまとまり: 山地、平野、気候帯など。流域境界をまたいでよい。
- 表示のタイル: 必要な画像だけを読み込むための単位。世界や河川の区切りではない。

河川に適した区切りをすべての自然現象の区切りに流用しない。

## 参照と採否

1. HydroBASINS 技術資料 v1.c §2.1–2.2
   https://data.hydrosheds.org/file/technical-documentation/HydroBASINS_TechDoc_v1c.pdf
   流向に沿った支流域、主流・支流の接続、小さな沿岸流域のまとめ方を参照。
   実データは細かいDEMから作られ、現在の粗いL0格子とは解像度が全く異なる。
   本実装はPfafstetter符号やその9分割、100/250km²の閾値を移植していない。
2. Génevaux et al. 2013, Terrain Generation Using Procedural Models Based on Hydrology
   https://doi.org/10.1145/2461912.2461996
   水系・流域・尾根を先に構造化する方針を参照。今回の追加調査では著者公開概要を確認、PDF取得は失敗。
   論文アルゴリズムを実装済みとはしない。
3. Yamazaki et al. 2019, MERIT Hydro
   https://doi.org/10.1029/2019WR024873
   標高だけからの流向推定と、実際の水域・河川の一致は別の検証対象であることを踏まえる。
   今回は論文概要のみ確認。90m地球データを取得・照合済みではない。

## 今回動くもの

`planRegionalDomains(snapshot, climate, settings)`:
- 保存された流向を上流からたどり、面積と起伏幅の作業予算内で連結した部分をまとめる。
- 沿岸の小流域を隣接条件つきでまとめる。内部の流向や複数の河口は維持する。
- 一つのL0陸域セルは必ず一地域だけに所属。湖面も既存のL0陸域支持に含まれる。
- 境界をまたぐ水供給は一つの共有portとして保存。流入＋域内の潜在供給＝流出を照合する。
- 隣接する地域は同じ境界IDを参照する。
- 気温・降水変更で供給量は変わるが、地形・地域区切りは変わらない。
- 面積予算より元のセル自体が大きければ未細分化として報告する。架空の細部は作らない。

これは既存L0の「どの範囲を一緒に解くか」を決める処理。
標高を補間しただけの拡大図を、新しく生成したL1地形とは呼ばない。
現在の共有portは通過帯の接続であって、実際の川幅・水位・詳細な通過点は未確定。

## このあと必要な実装と受入

1. 流域の内部生成に先立ち、外縁・流入口・流出口の地形と水位を共有記録として確定する。
   境界記録は両側で同じものを読み、先に確定した地域を後から動かさない。
2. 地域の形を保ち、山地・谷・平野と分岐した流路を一緒に生成する。
   現在の添付版の「矩形四辺は排水口」という前提は採らない。
   海へ流れる流域と終端湖の流域を別の水収支として扱う。
3. 気候、水の集まる場所、斜面から森林・草地・湿地・裸地を区分する。
   未確定の土壌・地下水・種構成を調査済みの事実として扱わない。
4. 複数の隣接地域を生成し、参照順を変え、再起動しても接続と位置が保たれることを確認。
5. 実地形の水系・土地被覆と同じ程度の広さで比較。2D画像をユーザーへ提示してレビュー。

上記1–5が済むまでL1を完成扱いしない。高さの精度だけを延々と改善する方向へ戻らない。

## 最初の比較実験と棄却した方法

### 1. L0の粗い区切りを、そのまま詳細な分水界にした試験

保存された planet-1 の海へ流れる3流域を12倍に細かく標本化した。
既存の滑らかな地表を使い、粗いセル境界を閉じて流出先だけ指定すると、
排水計算に必要な仮想的な水位上昇が最大735m、1583m、231mになった。
これらを実在の湖として追加していない。粗い流向・区切りと細かい地表が整合する、という
仮定が成立しなかった。この方法をL1の生成器として採用しない。

L0の地域分けは作業候補・供給量の集計として使う。細かな分水界の絶対条件にしない。

### 2. 添付版から選択した地形部

入力: ユーザー提供 dynamic-world-viewer/prototype-core.mjs。
SHA256: aacff0d1638134657c29660ccc03eaf0f5c8bbd95f238788ada052046c74a46d。
山の曲線配置、侵食風の整形、流路・分水界による谷の整形と、その依存関数だけを抽出した。
集落・道・社会的継続・ブラウザは取り込んでいない。
実験ファイル `attachment-landform-kernel.mjs` は39個の宣言、約33KB。
元のコード全体は約281KB。移植ライブラリを追加したのではなく、添付されたコードの選択抽出。

変更点:
- 河道の形の評価に追加のミクロノイズを使わず、地域の標高勾配を読む。
- 矩形四辺の高さを一律72m下げる処理を除去した。
- 元の排水を完成した世界水系とはせず、地形形状を作る内部ヒューリスティックに限定した。

### 3. 出口の条件が不適切な失敗

生成された四角い領域の全水量を、任意の南側出口一つへ押し込むと、
4seedで最大117–210mの切り込みを必要とし、枠沿いの不自然な溝が現れた。
流量保存・下り勾配が正しくても自然さは不合格。この方法は不採用。

### 4. 次の候補

地形候補を作り、その排水に沿って生成対象の流域を選ぶ。作業画面の四角い枠と
実際の地域の境界を区別する。未確定の周辺は「開いた調査範囲」として明示し、
海・確定済みの川などに偽装しない。

未確定候補の地形に対し、指定した流向の下り勾配を満たす幾何学的な補正も試した。
これは地質学的な時間発展・侵食シミュレーションではない。保存済みの地形は変更しない。
固定した境界条件と矛盾する場合は拒否する。

192×144、60m標本間隔の候補1件では最大切下げ9.32m、最大持上げ8.62m。
補正後のルーティングでは未解決の窪地が0。物理的な川幅・水深・堆積の完成を意味しない。
11.52×8.64kmは比較用の一例で、レイヤーの固定寸法ではない。

### 実地形との照合

NOAA ETOPO2022のトスカーナの標高部分を実際に取得した。
緯度43.2–43.3、経度11.15–11.3、約337×463m間隔、37×24標本。
取得先: https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.csv?z%5B%2843.2%29%3A1%3A%2843.3%29%5D%5B%2811.15%29%3A1%3A%2811.3%29%5D
データ情報: https://coastwatch.pfeg.noaa.gov/erddap/info/ETOPO_2022_v1_15s/index.html

同じ標高色範囲0–750m、実寸の傾斜陰影（高さ強調なし）で並べた。
実地形の水線も当方による標高からの推定であり、実測河川地図ではない。
両者の標本間隔・広さは一致していないため、細部の優劣を定量比較したものではない。
合流する谷や尾根と谷の関係を見るための初期的な比較である。

環境色の試作はL0の温帯林セル1933（年平均8.14℃、1362.1mm/年）の条件を使用した。
生成地形がその緯度経度に設置済み、という意味ではない。土壌の斑状変化は仮設定。
この条件では森林優勢となった。草地や湿地の比率の妥当性、周辺気候の勾配は未検証。

## 今回の到達点と残作業

動く: 粗い地域候補・水供給の接続と保存、明示的な流入口/流出口による排水、
添付の地形部だけの独立試作、候補地形への下り勾配制約、実標高との比較画像。

未完成: 任意の惑星位置でL0条件から地域生成器を選ぶ処理、隣接地域の形状と河道の同時確定、
川幅・水深・湖沼・氾濫原、地域の降水・植生の詳細化、全球ビューからの自動読み込み。
候補はまだ本番地形に接続していない。自動テストの成功をL1の完成として扱わない。

再実行:
- `node scripts/experiments/review-regional-layer.mjs OUTPUT_DIR [L0.json]`
  地形候補、制約補正、潜在的な排水、環境色の入力と出力をJSONへ保存する。
  水供給は200mm/年の独立した比較用入力。上記L0セルの降水量と同一の水収支として接続済みではない。
- `node scripts/plan-regional-domains.mjs L0.json SAVE_DIR OUTPUT.json`
  地域候補を一度保存し、同じ保存先を開くと同じ結果を再利用する。
- 実入力・実出力の集計: [l1-regional-review-2026-10-12.json](../reports/l1-regional-review-2026-10-12.json)。

この比較からの方針修正: 最初に仮の作業範囲を用意し、その中で地形と流域を提案して、
実際の生成地域の区切りを確定する。粗いセルの線を物理的な壁にしない。
既に確定した隣接地域がある場合はその境界条件を先に取り込み、合わない候補を拒否する。
今回確認したのは候補単体と固定標高への拒否試験までで、複数地域の同時確定は未完成。

## Final verification (2026-10-12)

The final source revision passed all 1,163 tests (0 failures, 0 skipped). Build verification imported 142 core modules, checked 30 legacy entry points and syntax-checked 57 globe modules. This verifies code contracts, not geographic realism or completed L1 integration. Browser QA was not run; review figures are offline plots of actual generated/reference data.

## L0への配置と隣接試験（追加）

ユーザーは上記の候補について「かなり良い」と評価した。これは候補の谷・川のまとまりへの評価であり、L1全体や独立地域接続の完成承認ではない。

`place-regional-candidate.mjs` は同じ候補の形を残して、保存されたL0の緯度・経度へ配置する試験。
粗い標高の傾向を加え、気候を補間し、局所高度差の気温減率を加える。水供給は親の `annualLocalYieldMm` と局所面積から算出する。
保存レコードは既存の原子的な保存処理を再利用し、再参照時の再生成と条件の無断変更を防ぐ。
`regionalView` は同じ記録を切り出すだけで、上流から来る流量を失わない。
これは表示分割であって、独立した地域生成の接続成功ではない。

実入力: planet-1、北緯43.59375度・東経158.90625度、192×144標本、60m間隔、seed=muna-atlas-001。
実出力: 年間潜在水供給13,810,892.14m³、相対収支差1.49e-15以下。基準との平均高度差0.00165m未満。
谷底補正は最大切下げ8.53m・持上げ8.32m。この水量は現実の観測値ではない。
適用範囲は内陸試験。海岸・湖面・外部からの流入・惑星ビューでの採用は未接続。

### 独立した東隣の試験は不採用

`extend-regional-candidate.mjs` は再現用の負の実験として残す。本番の生成器として公開しない。
旧地形と内部の流向を固定し、新地域のみ境界へ合わせ、循環と固定標高の矛盾を拒否する。
地形・旧河道を一切動かさず、水量保存を満たせる候補は得られた。
しかし目視では境界沿いに長い川ができた。地形を先に自由生成し、そのあと境界の標高だけを合わせる方法では不十分。
APIの `constraints-pass-visual-unapproved` は計算条件のみ通過の意味で、品質合格や採用ではない。

追加の診断では、境界の勾配を単純延長すると横縞、任意の河道を後から切ると深い人工的な溝が生じた。
これらの追加手法は公開コードに残さず、既存の承認候補や保存世界にも適用していない。

次に変えるべき順序:
1. 細部を確定する前に、周辺を含む低解像度の地形・水系を先読みし、接続先と谷の通過帯を予約する。
2. その通過帯を条件に、各地域の細部を生成する。完成した二つの地形を後から接着しない。
3. 生成済みの地形は保持する。相性の悪い新候補は拒否し、画面の四角い枠を自然の境界にしない。
4. この予約は川の先読みであり、全世界の村・建物を先に生成することではない。

追加参照: https://arxiv.org/html/2610.00301v1 （2026年9月のプレプリント、§1・3）。
地形表示と地域水系の前処理を分離し、必要な地域だけ計算する発想は参考になる。
一方、同論文は河川がプレート境界を横断しない制約を置く。この制約は本プロジェクトへ採用しない。
論文の下り勾配保証を、当方の隣接地域接続が完成した根拠には使わない。

追加後の最終検証: 1169 PASS / 0 fail / 0 skipped。ビルド成功（142 core / 30 legacy / 57 globe）。ブラウザ受入は未実施。

## 2026-10-12: L0 water sketch audit and real-Earth control

The user identified parallel, straight blue lines and asked whether actual
terrain would look this way at the same abstraction. A controlled run samples
NOAA ETOPO2022 at 128 × 64 cell centres and applies the same priority-flood
receiver algorithm as the generated planet. Both exhibit grid-aligned flow.
This is evidence of the processing limitation, NOT validation of naturalness.
Natural Earth 1:110 million mapped major rivers retain bends and network
structure when cartographically simplified; their 13 features are not a
complete river inventory and must not be used for equal-count comparisons.

The current algorithm's receivers follow flood discovery, not necessarily the
steepest filled-head gradient. An opt-in `steepest-filled` diagnostic selects
steepest spherical neighbour gradients and retains flood-tree routing on flats.
Historical default output and saved worlds are unchanged. This is still an
eight-neighbour method, not D-infinity. The diagnostic did NOT remove the
straight-grid appearance. Straight two-edge continuations actually increase
in this control; that scalar is not a naturalness objective.

`planet-landscape-sketch.mjs` preserves all coarse drainage destinations,
independently of the detailed river geometry budget. Its cell-centre edges are
explicitly unresolved corridors. It does not certify local boundary beds or
allow independent local commits. Source-cell support at the prior trial is
about 226 × 313 km, versus the 11.52 × 8.64 km trial. Height interpolation alone
cannot bridge this missing planning scale.

A frozen macro-recipe sampler now allows a bounded alternative planning grid
without recalculating the saved shoreline quantile. The 128 × 64 and 256 × 128
experiment is a comparison of generation plans, NEVER a camera-driven rebuild
of an existing world. Finer sampling alone does not create missing valleys.
The source grid's averaged polar rows are special; the sampler reproduces
nonpolar source samples exactly and the experiment separately applies the
same polar-row policy. Polar global hydrology remains an acknowledged limit.

### Next acceptance boundary

1. Plan connected major receiving waters, divide/valley corridors and shared
   crossing conditions before independent regional refinement.
2. Keep hydrologic planning resolution separate from overview display.
3. Retain the planned graph while simplifying its display; never re-infer
   drainage from a display-decimated elevation raster.
4. Refine only necessary regions with a drainage-aware surrounding context;
   persist results and shared constraints before further neighbour work.
5. Judge the resulting actual maps against real terrain and user review.
   Passing algebraic checks or drawing curved lines is not acceptance.

### Reproduce diagnostics

- `node scripts/audit-l0-sketch.mjs L0.json OUT.json [CELL WIDTH_M HEIGHT_M]`
- `node scripts/experiments/compare-hydrology-routing.mjs L0.json EARTH_GRID.json OUT.json`
- `node scripts/experiments/plan-macro-water.mjs L0.json OUT.json`

Earth input has `columns`, `rows`, `elevation` in north-to-south rows, longitude
0..360. The source download and observed diagnostic metrics are recorded in
`reports/l0-water-sketch-audit-2026-10-12.json`. Comparison images are offline
plots of actual arrays, not browser screenshots or image-generator output.

Sources:
- NOAA ETOPO2022: https://coastwatch.pfeg.noaa.gov/erddap/info/ETOPO_2022_v1_15s/index.html
- Natural Earth mapped major rivers: https://www.naturalearthdata.com/downloads/110m-physical-vectors/110m-rivers-lake-centerlines/
- Tarboton (1997), grid-direction bias and D-infinity: https://doi.org/10.1029/96WR03137

## Clarification: progressively double L0 itself

The user clarified that the requested sequence is L0 at 128×64, then 256×128,
then 512×256, rather than starting a separate one-tile local generator. This
sequence now executes through `createL0ResolutionSeries`; every stage has a
stable content ID and parent-stage reference. The saved recipe and shoreline
threshold are shared. Execution is bounded at 131,072 cells per stage and
checks available memory before each stage. The original world is unchanged.

The current sequence refines sampling of the macro field. It does not yet
constrain each stage's drainage to the previous stage's catchment topology.
Do not describe parent IDs as proof of hydraulic inheritance. Do not silently
freeze coarse grid artifacts as exact river paths merely to claim continuity.
This distinction is visible in the standalone review and machine report.

The new review builder embeds the three actual datasets into one HTML file.
Controls select resolution, common geographic window and displayed upstream
area threshold. A selected geographic point persists across resolution
changes. Switching views uses stored arrays, never generates a new world.
The legend explicitly separates elevation colours from vegetation, desert
and snow; water colours identify ocean, static lake cells and computed links.

Reproduce with the commands in `reports/l0-resolution-series-2026-10-12.json`.
Node-side control-handler tests cover next/back, endpoint button disabling,
point persistence and water display toggle. These are not browser-rendering
acceptance; the standalone HTML still needs real-browser review.
