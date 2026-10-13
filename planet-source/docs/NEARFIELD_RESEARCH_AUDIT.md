# 近景を地形・水・暮らしにつなぐ監査

2026-10-11。領有表示は広域セルと仮 ID に限定する。土地一筆ごとの所有制度は今回追加しない。
この報告は、Google Earth の参照画像、実際の生成データ、下記の一次研究を照合したもの。
道路や建物の数、テスト件数だけを「自然な集落」の合格条件にしない。

## 今回確認できたこと

- 保存世界 `9f77ea6d…` の地域 3237 を、配布に使う地域プランナーで生成した。
  村 `pop:3237:5` は住宅 60 戸＋その他 6 棟、道路 43 本、区画 19 個。
  町 `pop:3237:0` は区画 0 の住宅 96 戸＋その他 7 棟、道路 47 本、区画 45 個。
  町全体は 9 区画・要求住宅 800 戸なので、一区画の成功を町の完成とは呼ばない。
- 建物の向き、道、庭、教会用地は実装されている。添付 SVG はその実座標。
  背景に森・水・起伏を描いていない診断図であり、実ゲーム画面ではない。
  この空白から森や地形の不在を推定してはいけない。
- 別の 3.2 km 四方の低地 2 地点では、実際の標高差が約 0.029 m と 0.307 m。
  起伏の設定値ではなく実出力を調べた結果。すべての平地を丘に変えるべきという意味ではない。
- 同じ惑星の人口のある 744 地域中、既存の川沿い立地候補があるのは 12 地域。
  現行の疎な河川では候補上限に達していない。上限を上げるだけでは埋まらない。

詳細: [実入力・出力報告](../reports/nearfield-production-scene-2026-10-11.json)、
[実座標の平面図](../reports/nearfield-production-scene-2026-10-11.svg)、
[低地・河谷の実測](../reports/research-nearfield-incision-2026-10-11.json)。

## 研究と照らして足りないもの

| 領域 | 参照する研究の着眼点 | 現状の不足と実装判断 |
|---|---|---|
| 山・丘・谷 | Génevaux 2013 の水系主導地形、Cortial 2020 の地形特徴を受け継ぐ多段階詳細化 | 大陸級の基盤と局所ノイズの間の地形構造が弱い。起伏を増幅するだけでは谷・尾根と水系が一致しない。既存河川と共有境界を守る親子地形の処理が必要。 |
| 河川と居住 | Génevaux 2013、Peytavie 2019 の水系・地形断面の結合 | 川の周囲だけの小川実験では、多くの集落の環境が未設定のまま。まず広域の流路採用と立地候補への接続を改善する。 |
| 道と街区 | Emilien 2012 の地形・需要・アクセスによる村の成長、Galin 2010 の地形費用に基づく道 | 村の地形対応はあるが、町には規則的な街区が残る。段階的拡張、門・街道・水場との関係を追う必要がある。無意味なランダムな曲がりは加えない。 |
| 森 | Kapp 2020 の樹冠・下草・林床の組合せ | 斑状の樹木配置はあるが、植生の層、縁、開墾との関係を同じ土地利用から組み立てる部分が不足。論文のデータ駆動生態系を実装済みとはしない。 |
| 畑・庭 | Holata & Malina 2024 の実際の中世圃場の多様性 | 家の背後の庭と郊外農地はあるが、一様な長方形や一律の斜面規則だけでは足りない。作物・労働・アクセスと地形への適応が必要。田んぼを全文化に自動追加するのも不適切。 |
| 遠近の一致 | Losasso & Hoppe 2004 の LOD と生成の区別 | 詳細化で新しい別地形を出さない。同じ標高場・水系・固定 ID を描き分け、位置の再抽選をしない。描画負荷の許す範囲で詳細を読む。 |

## 実装した改善と、その限界

### 必要な一地域だけを同じ方法で作る

`createSettlementRegionPlanner` を配布処理から抽出した。地域だけを調べる場合にも、
配布時と同じ立地・道路・文化設定を用い、全惑星の家を作らない。
実際の配布された地域 JSON と繰り返し一致することをテストする。

`node --max-old-space-size=256 scripts/audit-nearfield-scene.mjs SAVED_WORLD.json REGION_INDEX OUTPUT_PREFIX`
で、実際の村と町の一区画の JSON / SVG を得られる。架空の代替サンプルは生成しない。

### 河川を増やしても、一部地域だけに候補を使い切らない

既存の同じ排水網について、河川として採用する集水閾値を 20 → 5 → 2 と比較した。
5 の場合は 39 → 344 流路、25,683 点、今回の入力で棄却 0。
ただし旧候補選定は ID 順の先頭で枠を使い切り、立地候補のある人口地域は 12 のままだった。

新しい `river-access-siting@2` は、同じ 32,768 候補の枠を地域・集落種別に配分する。
地域内では固定 ID の順位で候補を保持する。カメラや呼び出し順では決めない。
今回の比較では候補のある人口地域が 12 → 195 に増えた。
これは「195 地域の給水を保証した」という意味ではない。実際の乾いた接近路、勾配、
受け入れ水源の確認は既存の立地調査で別途必要となる。井戸・湧水・飲用適性は未実装。

新規生成に `riverDetail: 'regional'` / `--river-detail=regional` を接続した。
画面では「地域の河川も生成（試作・時間増）」で選べる。軽量な既定は従来の主な河川。
地域河川を選ぶと、地形を掘る河床、水面、立地候補が同じ保存水系を参照する。
UI 生成先の識別子も分け、既存保存世界の位置やファイルを上書きしない。
旧世界の `river-access-siting@1` も従来の計算を維持する。

閾値 2 は今回不採用。32,768 河川点の枠を先に使い切り、1,568 流路が棄却された。
候補選びを均等にしても、生成されなかった河川は取り戻せない。
地域河川 5 も、すべての seed や連続水理・外観の完成を証明したものではない。
詳細: [河川と立地候補の比較](../reports/research-water-coverage-2026-10-11.json)。

## 引き続き必要な受入

1. 新しい保存世界の地域 5010 では、20 提案のうち 4 村で川岸への自然地形の接近を確認し、
   後述の実歩道へ接続した。次は未接続例と適用地域を広げ、地形の条件との整合を確認する。
2. 谷の直線的な掘り込みと低地の起伏抑制を、親の水系と連続な地形として改善する。
3. 町の全区画、集落の縁と周辺の森・耕作地を同じ生成経路で検査する。
4. ブラウザの実画面を検証する。現在の環境では起動／接続が阻まれており未検証。
   SVG や数値テストをブラウザ合格の代用にしない。

## 一次資料と読めた範囲

- [Génevaux et al. 2013](https://perso.liris.cnrs.fr/eric.galin/Articles/2013-river-networks.pdf): 水系から地形を組み立てる本文の関連箇所。
- [Cortial et al. 2020](https://perso.liris.cnrs.fr/apeytavi/website/publication/hal-02967067/): 著者概要と公開実装の関連シェーダー。論文全文を精読したという主張ではない。
- [Peytavie et al. 2019](https://cs.purdue.edu/homes/bbenes/papers/Peytavie19CGF.pdf): 河道分類・断面・水面に関わる本文。経験式を物理的完全性と混同しない。
- [Emilien et al. 2012](https://perso.liris.cnrs.fr/egalin/Articles/2012-villages.pdf): 需要と地形に基づく村・道・敷地の逐次配置。
- [Galin et al. 2010](https://perso.liris.cnrs.fr/egalin/Articles/2010-roads.pdf): 道路生成の概要・導入。
- [Kapp et al. 2020](https://people.cs.uct.ac.za/~jgain/wp-content/papercite-data/pdf/kapp2020.pdf): 生態系合成の概要・導入。必要な学習用生態データは本プロジェクトにはない。
- [Holata & Malina 2024](https://digilib.phil.muni.cz/sites/default/files/pdf/AH2024-2-07.pdf): 中世村落圃場に関する英語概要。対象地域の観察を全世界共通の規則にしない。
- [Losasso & Hoppe 2004](https://hhoppe.com/geomclipmap.pdf): 描画 LOD の導入と制約。

## この変更の検証

- 全体テスト 898 PASS / 0 fail / 0 skip（単一ワーカー、256 MiB heap、約 263 秒）。
- その後に追加した API 引数転送と @2 配布・復元の 2 件を含む接続試験 17 PASS。
- build は core 116 / globe 47 モジュールを確認。
- 村・町一区画の実形状ハッシュは再生成で一致。ブラウザ実画面は未確認。

## 川岸への接続を実形状にする（10:43 UTC 時点の続き）

`surveyed-riverbank-footpath@1` を、新規の水辺立地政策に接続した。
実際の川の ID と乾いた川岸を再確認し、村内の道から幅 1.3 m の歩道を作る。
住宅より先に道を確保し、家の基礎や庭が道を塞がないようにする。
道は共通の道路レシピに入り、見た目専用の線を重ねる方式ではない。

地域 5010 の実際の 4 村で、108.62 / 153.01 / 98.39 / 184.06 m の歩道を作れた。
全村で要求住宅 60 戸を保持。共通の物理サンプラーによる確認点では、
水没・建物との衝突・道路面の欠落はいずれも 0。ブラウザ実画面や連続全点の保証ではない。

初回の監査では 4 村とも失敗した。共同池の局所サンプラーが、池の外にある既存の川の
水位を引き継ぎながら水源 ID を捨てていたためである。池自身の水と周囲の川を取り違えず、
それぞれの ID を引き継ぐよう修正し、旧・新両方の共同池政策をテストした。

制約は明示する。村の範囲内で最大 12 本の接続候補を調べ、300 m 以下、縦断勾配 18% 以下、
半メートル間隔の幅員調査で通るものだけを採用する。街路からつながらない川岸は未接続のまま。
都市の水道、取水量、飲用適性、洪水安全性は扱っていない。画面の住宅進捗とは別に
「川岸への道：接続／未確認」を表示する。旧保存世界にはこの政策を後付けしない。

- [4 村の実測](../reports/riverbank-physical-audit-2026-10-11.json)
- [一村の再現可能な実形状報告](../reports/riverbank-production-scene-2026-10-11.json)
- [一村の平面図](../reports/riverbank-production-scene-2026-10-11.svg)

監査コマンドの末尾に SITE_ID を指定すると、地域内の実在する一集落を調べられる。
対象が見つからない場合は架空の代用品を生成せずエラーにする。

川岸への接続を含む最終コードの回帰確認: 906 PASS / 0 fail / 0 skip、約 276 秒。
build は core 117 / globe 47 モジュールで成功。単一ワーカー、256 MiB heap を維持した。

## 2026-10-11: Explicit alluvial cross-section candidate

The channel/floor/outer-bank distinction in Peytavie et al. (2019, Procedural Riverscapes, DOI 10.1111/cgf.13814), and the river-distance/profile separation in Cortial et al. (2020, DOI 10.1007/s00371-020-01923-4, author `profiles.comp` read), motivates a small independent cross-section implementation. No external implementation was copied. This is not their Rosgen classifier or a sediment/discharge simulation.

`generatePlanet({valleySections:'alluvial'})` / CLI `--valley-sections=alluvial` explicitly opts into `c1-incision-alluvial-bench@3`. Default `legacy` retains the previous river method and saved geography. Node positions, profile centre lines and water levels remain fixed. For gentle reaches, a bounded floor is inserted between the channel and outer bank, with C1 blending. Assumed grades .001–.005, floor width up to 400 m and rise up to 1.5 m are declared game-scale controls, not inferred geological measurements. There is no claim of flood safety. Resident and paged terrain consume the same river sampler; view distance cannot move it. No UI default switch has been made.

Actual regional `planet-1` comparison at river:3670:3541, point25: 1.6 km square, 161×161 samples, identical coordinates. Max height change 1.963716 m; 1257/25921 samples changed. Inspection of a same-lighting, same-scale raster showed only a small visual difference and an unchanged straight river. **Cross-section adjustment alone does not solve the near-field problem.** Complete numbers: `reports/alluvial-section-comparison-2026-10-11.json`. Four actual water-sited villages in region5010 retain 60 homes each and connected sampled dry paths in the candidate world; finite checks are recorded separately in `reports/alluvial-riverbank-audit-2026-10-11.json`. They do not certify continuous paths or browser rendering.

The next shape problem is the river trajectory and the surrounding coherent relief. Paris et al. (2023, DOI 10.1145/3618350, author abstract read) model curvature-driven migration with terrain constraints and topological events; arbitrary sine displacement is not an equivalent implementation. Grenier et al. (2024, DOI 10.1111/cgf.14992, abstract read) align structured detail with flow/slope. These are additional research leads, not implemented claims.

A user-requested imagegen meadow/soil texture is stored as an unintegrated candidate under `assets/textures/candidates/`. It supplies appearance only, never elevations, waterways, vegetation distribution or land ownership. No claim of seamlessness or successful runtime integration is made.

## Actual mesh inspection and chart-edge repair candidate

While preparing an image with the production paged mesh builder and CPU renderer, packaging village `pop:5010:26` failed with `Feature earthwork reaches chart boundary`. A 65-point-per-side audit of the original chart found 0.029314 m and 0.134083 m edge deviations (plus -0.000726 m). This is a geometry continuity issue that the earlier interior road samples did not test.

The explicit `c1-outer-earthwork-apron@1` policy encloses road carriageways, water footprints and foundations in an unchanged inner rectangle, then adds a 30 m outer apron. Only exterior earthwork is blended to the canonical base with a C1 weight. Buildings, roads, water positions and their inner surface heights remain unchanged. Declared footprints outside the inner rectangle reject; interval bounds include the same blending. Existing saved worlds without this policy keep their previous recipes. New climate-planned worlds propagate the policy through the actual regional planner to villages; urban district joins are not claimed fixed by this change. The generation cache version advances to `planet-ui-generator@12` and the runtime capability version to `settlement-runtime@28`.

The same finite outer-edge audit returns zero deviations above 1e-9 m after the candidate repair. This numerical survey supports, but is distinct from, the compact-envelope construction. Envelope shape and interval-convergence tests plus actual regional-layout propagation tests were added. Batter-slope limits and joins between separate feature charts still require their own checks; a C1 edge alone is not proof of those properties.

`scripts/render-nearfield-scene.mjs WORLD.json REGION OUTPUT_PREFIX [SITE_ID]` supplies a reproducible image using actual generated layouts, paged terrain meshes, building meshes and the existing CPU diagnostic renderer. It renders a bounded 3×3 tile window with one selected district. The first inspection was 420×315; the exporter now explicitly requests 1200×900 and oblique light, while the interactive CPU fallback retains its original 420-pixel cap. Export resolution is capped at 2048 pixels on either edge and never changes canonical geometry. Black is outside that window. It does not include a browser UI, WebGL performance, imagegen textures or woodland instances. The initial inspected candidate image contained 22,793 triangles. The tool refuses an invalid legacy chart at packaging rather than silently ignoring its continuity check.

## 2026-10-11: Hills, woodland and scale-aware contour inspection

User-requested inspection distinguishes terrain existence from a designed village-edge hill relationship. The saved candidate has 900 m / 100 m local-hill noise controls, conditioned by elevation and shore constraints; these controls do not guarantee a 100 m hill. At pop:2117:1, a sampled 2 km square spans 606.014–689.950 m. Removing a fitted planar slope leaves a 70.322 m residual range. These finite samples establish nonplanar relief, not plausible geomorphology or access to a hill. No hill-landmark / village-edge access planner was found in the inspected settlement generation path.

A direct woodland-generation probe of the nine approximately 256 m tiles nearest the same village, using actual regional settlement context, produced zero trees. This is not proof that the world has no forest; it also is not full paged-runtime verification. Woodland generation and trunk/crown mesh paths exist, with fixed geographic tile IDs, climate/land-use clearing, optional patch density and road clearance. Forest age, species succession and forestry are not simulated. Previous CPU scene images intentionally omitted woodland loading.

The globe now offers automatic contour spacing, plus explicit 2 m and 5 m options. Automatic spacing uses estimated target-plane view span, not relief exaggeration: 2/5/10/20/50/100/250/500/1000 m. CPU and WebGL receive the same selected interval. No terrain, settlement coordinates or saved geography changes. Oblique view span is approximate, and unresolved lines may be suppressed by existing screen-space anti-aliasing; no claim of complete offscreen contours or browser acceptance is made.

Five same-centre base-terrain plots use widths 500 km, 100 km, 10 km, 2 km and 500 m with intervals 500, 100, 20, 10 and 2 m respectively. Each panel samples 101×101 positions; wide panels undersample small hills and are not proof that every contour persists at every LOD. No building/road earthworks are included in these plots.

## 2026-10-11: User correction — missing steep landforms, not just village shading

The user clarified that the village itself is acceptable at this stage; the concern is a world dominated by gentle undulations with few convincing cliffs. This supersedes treating camera/light changes as the main remedy. Geometry inspection at the same village with a low camera and 1×/5× vertical scale confirms real vertex displacement, but also exposes an existing display limitation: buildings stretch with the terrain. Neither exaggeration nor texture is a substitute for missing landform structure.

`scripts/audit-terrain-slopes.mjs` measures four fixed subcell positions in each source land cell, using a 5 m central derivative and excluding currently submerged points. On the same candidate world: 13,930 dry samples; counts in bins ≤5°, 5–15°, 15–30°, 30–45°, 45–60°, >60° are 8442, 4985, 501, 1, 1, 0. Latitude-weighted area estimates put about 95.2% below 15°. This is finite stratified sampling and can miss narrow cliffs. It supports a gentle-relief bias, not an absence proof or a target distribution for Earth.

Additional primary research read: Cordonnier et al., *Sculpting Mountains: Interactive Terrain Modeling Based on Subsurface Geology*, TVCG 2018, DOI https://doi.org/10.1109/TVCG.2017.2689022, sections 5–7. Their fold skeletons provide directional multi-scale structure; material-dependent erosion and talus limits produce ledges and cliffs. This suggests separating regional structure, resistance and erosion response, rather than simply increasing noise amplitude. Their implementation is not adopted, no source code copied, and their numerical settings are not universal geological constants.

Implementation acceptance now needs both representation and generation checks:
- Keep plains and gentle hills; add plausible steep terrain where regional structure and material justify it. Do not turn every example into a global rule.
- Inspect ridge continuity, incised valleys, rock scarps and coastal relief at fixed coordinates, with 1× actual geometry as well as explicitly labelled exaggeration.
- Use the same surface for global/local meshes, water, slope, roads and placement; retain deterministic saved worlds.
- Check finite LOD bounds and tile seams for any sharper profile. A narrow cliff cannot be declared present merely because a high-resolution sampler knows it while the displayed mesh omits it.
- Height-field surfaces can describe steep finite slopes but not genuine overhangs or multiple ground heights at one horizontal position. Those require a deliberate local geometry extension; do not imply the current representation already supports them.

No new geological relief generator has been completed by this checkpoint. Current published automatic contours are an inspection aid, not a repair of this generation deficit.

### Explicit analytical ridge/strata candidate (not a geological simulation)

`landformShape:'stratified'` / `--landform-shape=stratified` uses the shared `resistance-masked-ridge-strata@1` band evaluator for mountain massifs only. The browser generation form exposes it as a trial choice; the default remains `rounded`. A wider seeded field varies an analytical four-layer profile over rounded ridges. This is an authored material/profile scenario inspired by the separation of structure and resistance discussed above, not a port of Cordonnier's folding, erosion, discharge, or landslide simulation. It does not produce overhangs. The ridge mapping is bounded and C1, and the conservative derivative multiplier is 13. Canonical, paged and package pole-mean evaluations use the identical mapping; existing shoreline constraints remain in place.

The unchanged test world's mountain band was replaced in a separate snapshot solely for same-coordinate comparison. Old worlds are not rewritten. Actual new-generation requests run the normal hydrology and siting pipeline using the shaped base; the diagnostic snapshot is not evidence that every changed waterway or settlement remains valid. Default options reproduce the old base identity. Shaped/rounded generation cache paths are distinct.

On the same 13,930 dry stratified samples, candidate counts are 8266,3541,1532,329,174,88 in the six slope bins; the estimated area fraction above 30° rises from about 0.02% to 5.56%. This is a response measurement, not an Earth reference distribution or realism score. An inspected river-centred comparison still has an unnaturally straight channel, dark slopes and coarse narrow-edge rendering. Sharper hills alone do not resolve those defects. Candidate image inspection and broader regression checks remain necessary before any default adoption.

### Follow-up: reject a weak visual experiment; isolate resolution error

A second local trial varied bed thicknesses and spatial phase in the analytical ridge profile. It passed its focused numeric tests but retained conspicuous circular shelf shapes and jagged coarse rims in an actual production CPU-mesh render. It was rejected and its runtime/UI/test changes were removed before publication. All 15 files from commit eae920e526508631e6cafb3f7c0dae0a3ea4c1ae were compared against that commit's recorded blob hashes and remained identical after removal. More randomized shelves alone are not the missing regional geology. The existing explicit first trial is still experimental, not the default.

The source also exposes a structural scale gap: global source samples are hundreds of kilometres apart at the default grid; local bands have wavelengths 2.5 km, 900 m, 180 m and 8 m. A continuous query is supported, but organized intermediate-scale valley/ridge structure is not thereby supplied. This does not prove that every intermediate feature is absent: the coarse interpolant and river corridors also contribute. It explains why adding sharper local noise is insufficient to claim convincing regional mountain ranges.

`scripts/audit-terrain-resolution.mjs` now compares the canonical scalar radial height with the cube tile's 16-cell triangle interpolation at fixed coordinates. It accepts a finite bearing and bounded transect; it does not substitute the diagnostic for actual streaming/browser verification. At the sampled steep candidate location (-10.546875°, -18.984375°), the north–south 1 km transect sampled every 2 m has maximum absolute errors of 120.67, 79.45, 29.51, 12.06, 3.02 and 0.80 m for levels 12–17. The report retains all-level aggregates and every 25th profile sample. These are finite samples, not certified error bounds. An east–west transect at the same position yielded similar interpolation error, but mostly runs along the cliff; it must not be used as an illustration of the steepest cross-section.

This diagnostic excludes ECEF chord error, Float32, parent morphs, edge stitching, feature refinement and actual automatic LOD selection. The existing renderer's conservative error certificates must remain in force; do not replace them with these sampled numbers. The production viewer still needs executable browser acceptance once its environment is available.

Next generation work should couple regional drainage/ridge structure and material response, then refine the shared surface, instead of independently inserting cliffs into camera-local tiles. Tzathas et al. 2024 (https://doi.org/10.1111/cgf.15033), sections 3–4, explicitly couples drainage and elevation; its river-network/elevation dependency means a fixed-network profile is not a full erosion solution. No erosion implementation or paper reproduction is claimed here. Saved-world identity and source-centre/shore constraints remain mandatory.

Grenier et al. 2024 (https://doi.org/10.1111/cgf.14992), sections 3.3–5.4, is a useful control-map reference for slope-aligned ravines, but explicitly excludes convincing plateau/cliff amplification and global coherent drainage. It should not be presented as the sole cliff solution. Its use here remains research, not an implemented method.

Verification for this diagnostic follow-up: the complete sequential suite includes all four new resolution-audit tests (924 passed, 0 failed, 0 skipped). The rejected second profile does not remain in runtime code. This improves defect measurement, not the underlying landform realism; geological generation and browser acceptance are still unfinished.

## Earth data and landform classification, 2026-10-11

User requested actual landform classification and Earth maps. `reference/earth-terrain/` contains the reference catalogue, provenance/hashes, six real ETOPO crop statistics, and four Terrain22 crop class counts. Six 121×121 ETOPO CSVs and three Terrain22 regional ZIPs were actually downloaded and inspected locally. Raw data stays outside Git; a bounded standard-library downloader recovers the exact hash-verified inputs. The code never runs downloaded content. Four offline Python downloader tests pass.

The catalogue keeps source classes distinct from project description axes and implementation status. The 22 Terrain22 groups are not a claim that all 22 generators exist. Geometry, observation scale and inferred formation process are separate; unavailable data is not classified as flat land or water. Modern reclamation and the finite resolution of global DEMs limit their medieval/local applicability.

`compare-earth-reference.mjs` uses the same tangent-metre grid and central differences for Earth and generated crops, rather than comparing 5 m generated slopes directly with 15 arc-second DEM slopes. At one deliberately selected mountain window, the rounded/strata worlds have relief 1043/1148 m versus the chosen Alps window's 3852 m; median slopes 7.0°/13.5° versus 23.0°. These are selected windows, not a global realism score or universal target. Production generated-world classification and geological generation are still unfinished. See the reference README for exact commands, sources, limitations and actual outputs.

### 2026-10-11 — 地形分類を保存世界の調査導線へ接続

既存landform-inspectionに有限8方向の形状判定を追加。GRASS公式geomorphon凡例の10種集約を参照するが、独立の連続地表サンプラーでありGRASS再現やTerrain22の適用ではない。固定した250m/2.5km/25kmの範囲を明記し、新規manifestの起伏移動先で参考形状を表示する。カメラのズーム・訪問順で地形を生成し直さない。

既存rounded世界7b193113…の6地点を実測。追加2310回、元の移動先調査363回、合計2673回、約0.46秒。山地域4215は250mで斜面、2.5kmで張り出し、25kmで尾根状。これは同じ場所の異なる範囲での記述で、相互矛盾ではない。診断図は保存地形65×65格子、同一中心、各範囲の等高線。実ゲーム画面ではない。

Missing値を形状に埋めない。湿地・川・湖・地質・植生は幾何形状から推論しない。集約表の回転・反転不変性、平面/峰/谷等の既知形状と尺度変更を限定的に検証。全世界の地形分類マップ、成因に沿う生成、実ブラウザの表示受入は引き続き未完了。

### Fine Earth references and rejected relief trials

Actually retrieved 18 GSI DEM5A elevation PNGs for Numata river terraces and Byobugaura sea cliffs, each 3×3 tiles at zoom 15. Reference-only, no changes to world generation. Source is 5m-class data; interpolated pixel spacing is about 3.8m, not independent finer measurement. Retain missing values, particularly coastal water, instead of fabricating a zero-height wall. Hashes and acquisition metadata are in `reference/earth-terrain/gsi-local-manifest.json`; actual input/output statistics in `reports/earth-local-landforms-2026-10-11.json`. Inspected and shared equal-location contours and fixed centre-column profiles. Modern modified terrain is not a medieval reconstruction.

Several off-repository trials were rejected or retained as unaccepted diagnostics; none is production code:
- Increasing mountain wavelengths to 32km and adding a multi-scale ridge envelope made one mountain region more varied but another smoother and retained repeated lattice patterns. More noise bands are not a drainage hierarchy.
- A constructive branch profile could be downhill longitudinally while standing ABOVE both sides transversely (11/11 fitted branches at one site, 7/8 at another). A downhill numerical check is insufficient evidence of an incised valley.
- Terrain-first implicit incision on two mountain patches produced cuts up to about 621m and 175m and more visible valleys. However, diagonal grid artifacts and the protected old-river corridor remain conspicuous. Cut volume has no balancing sediment deposition; the elapsed-iteration parameter is not a calibrated geological chronology.
- An independent two-receiver angular-routing prototype, informed by Tarboton 1997 (https://doi.org/10.1029/96WR03137), passed two limited planar-direction/missing-route tests but did not remove the visible grid/sink artifacts. It is not a full TauDEM reproduction and is not adopted. Its coupling to protected boundaries still needs hydrological acceptance.

These findings strengthen the need to build connected regional drainage, ridges and surface shape together. Do not publish these rejected numerical successes as a realism fix. The new GSI references show broad low-slope surfaces adjoining concentrated scarps and valley networks; a uniformly sharper surface would miss that structure. Browser/WebGL acceptance remains blocked as previously documented. The existing runtime remains the 930-test checkpoint; new reference utilities have separate offline Python checks.

### External implementation cross-check

Installed the official PyPI binary `fastscapelib==0.3.0` into an external temporary reference environment, without modifying runtime dependencies. Official documentation: https://fastscapelib.readthedocs.io/en/latest/ ; GFZ project overview: https://www.gfz.de/en/section/earth-surface-process-modelling/projects/current-projects/fastscape-landscape-evolution-model-development . The library is GPL-3.0; it has not been bundled into planet, ported into its runtime, or adopted as the project's licence.

Actual bounded runs include seeded synthetic uplifted terrain and a 60m escarpment, then two saved-world mountain patches under their old protected-river constraints. The synthetic example gives connected dendritic valleys, but applying the same established solver after the current noisy surface retains unwanted sink-centred patterns and protected-corridor artifacts. A coarse-field-only attempt under the old river controls also has regular boundary/direction artifacts. These comparisons isolate initial topology and boundary conditions as unresolved issues; they do not prove that any solver will fix the current world by being bolted on. All remain unadopted. Actual scalar reports are in `reports/relief-solver-comparison-2026-10-11.json`; no demo is represented as a production screenshot.

Lindsay 2016 (https://doi.org/10.1002/hyp.10648), sections on when to breach/fill and the algorithm, was also read from the author's paper. Artificial DEM obstructions and genuine closed basins must be distinguished; making every depression drain would erase valid landforms. Bounded carve and irregular-mesh variants of the earlier local experiment were inspected but are not accepted as production geology. The next integration must establish regional outlet/basin controls before generating fine relief, preserve genuine internal drainage, and derive water/placement from the resulting shared surface. It must not keep a visually invalid old micro-relief merely to preserve a diagnostic patch's appearance, nor silently change a saved world's identity.

### Bounded drainage-domain planning groundwork

`scripts/experiments/relief-domains.mjs` partitions the saved receiver forest into deterministic connected groups of at most 64 coarse cells, with a single canonical portal identity for every cross-group receiver edge. Source height, virtual fill-routing level and actual water are not collapsed into one field. Source lake footprints and ocean masks suppress dry-land work for water-only groups. It validates acyclicity, finite data and work bounds, and does not modify the saved source.

Actual 8192-cell input: 4011 groups, of which 775 include dry land and 3236 are water-only; 263 shared graph portals. Of those portals, 210 are downhill in source ground and 53 are routed through source fill levels rather than downhill along the lake bed. Small arithmetic cancellation at equal lake levels is handled using an explicit magnitude-scaled floating-point tolerance; larger discrepancies remain unresolved. These 53 are not presented as defective lakes. Five focused tests cover partition/connectivity, shared ownership, missing masks, lake/ground separation, roundoff and invalid inputs. `reports/relief-domain-plan-2026-10-11.json` is actual output.

This is a planning decomposition, not the missing terrain generator. A cell budget is not a physical-area budget; a source cell is far larger than a village, and regions still require finer subdivision. The graph portals are not complete geometric ridge borders, nor continuous hydraulic proofs. The next stage must make shared outlet/ridge geometry and finer drainage govern the terrain before deriving local water and placement. No global/runtime export or viewer connection is added for these provisional planning objects.

### Independent relief solver and existing terrain-format connection

The new research solver in `scripts/experiments/mst-relief.mjs` implements basin adjacency, minimum passes, a Kruskal tree and original receiver-path reversal following Cordonnier, Bovy & Braun 2019 (https://doi.org/10.5194/esurf-7-549-2019), then implicit n=1 stream-power erosion. It is independently written from the paper, not copied from Fastscapelib. The external GPL library remains an isolated benchmark only. The implementation is O(E log E), not the paper's linear-time variant. Genuine retained internal terminals can be supplied explicitly. Fixed raster boundaries are scenario controls, not a planetary boundary solution.

`relief-terrain.mjs` exports through the EXISTING canonical terrain @3 and bounded C1 interpolation. The existing viewer's restoration path can read it. There is no second renderer-only height field: source nodes, restored samples and different sampling orders reference one saved identity. Simulated drainage area is not labelled as a river, water surface, lake or observed flow. Source vertices occupy 0..extent; the format's outer half-cell rim is only clamped support. Runtime defaults and saved planet identities remain unchanged.

Actual reproducible scenarios are generated by `node --max-old-space-size=256 scripts/experiments/run-relief-scenarios.mjs OUTPUT_DIRECTORY` (fresh output directory, no overwrite):
- 50km, 129², near-flat deterministic input, bounded uplift and stream-power evolution: about 1843m relief, branched valleys and ridges. Fixed edges create artificial central/topographic structure; this is not calibrated Earth history.
- 3km, 129²: a deliberately authored 60m escarpment is eroded. The initial cliff's existence/location is an INPUT, not proof that the generator predicts where cliffs should form. Final graph retains 230 uphill edges. Neither graph connectivity nor its picture establishes valid river beds.

Ten focused checks cover graph termination/area, explicit closed terminals, rough/flat inputs, finite bounds, the implicit recurrence, canonical restoration through the actual viewer loader, repeatability, sampling-order stability and input isolation. A separate external numerical comparison has zero height difference for two simple one-step 9² surfaces, but the 129² synthetic case differs by RMS 24.67m after 100 steps. No bit-identical library reproduction is claimed; it is not necessary for the independently defined solver, but the difference remains part of the audit.

The real GSI data are now used for a matched-extent diagnostic rather than only displayed. Fixed centre 2.8km crops, 25m point sampling and 50m slope stencils give synthetic escarpment P95 slope 22.77°, versus Byobugaura 21.84°. That apparent agreement is misleading in isolation: slope below 1° occupies 71.1% of the synthetic surface versus 37.2% of valid Byobugaura samples; Numata is 11.2%. The prototype is too uniformly flat away from the escarpment. Missing real samples are retained, interpolation is explicitly bilinear without antialias filtering, and these selected sites are not a global target distribution. This is evidence against accepting the prototype as realistic terrain solely from steep-slope percentiles.

Actual inputs/outputs and limitations: `reports/independent-relief-solver-2026-10-11.json`. CPU plots were inspected, not passed off as browser screenshots. The next integration still needs common regional boundary geometry, spatially appropriate uplift/resistance/landform controls, genuine internal basins, and a common final surface from which water and placement are derived. The locally compatible output is progress, not a claim that the planetary generator is finished.

### Shared regional solution, bounded render subregions

`relief-tiles.mjs` crops an already solved regional field into separately restorable canonical tiles. It does not re-run erosion for each camera tile. The parent identity, global planar coordinates, active bounds and source node window are explicit. Only active bounds are owned/drawable; the support rim must not be treated as another region. It validates a bounded source and derivative stencil.

An initial one-node halo passed node-height checks but failed just outside seams and at finite-difference normals, because the crop's outer derivative is clamped. It was corrected to TWO nodes, retaining the neighbouring Hermite patch's derivative support as well. Three focused tests now pass, covering seams, four-way corners, reverse request order, serialization, source isolation and invalid windows. The actual two saved scenarios each have 6168 boundary height/slope probes: maximum height differences are about 9.1e-13m and 6.8e-14m; maximum slope differences are about 1.3e-12 and 1.5e-13. This is floating-point agreement with one parent surface, not evidence that independent watersheds can be stitched safely. Geometry/normal continuity across planetary watershed boundaries and actual render-LOD transitions remain open.

### Explicit spatial forcing and bounded hillslope transport

The same research solver now accepts owned per-node uplift and erodibility fields, in addition to scalars. Uniform fields reproduce scalar output exactly. No landform label is treated as proof of a material property. A single continuous, prescribed uplift belt can locate an elongated mountain region; it is not simulated plate tectonics or an inferred geological fact. Full forcing arrays are retained in the canonical scenario's provenance; compact diagnostics give their hash/range.

An optional linear hillslope-diffusion step uses paired equal-and-opposite orthogonal transfers, a constant-density planar-cell volume interpretation, a CFL ratio <=0.2 and at most 64 substeps. It rejects excess work before evolution, does not silently clip material, preserves fixed nodes and reports signed exchange with those reservoirs. Closed-grid conservation and no new extrema are tested for the diffusion step; those properties do not mean the entire uplift/stream-power simulation conserves rock volume (channel erosion has no downstream sediment store). Zero diffusion preserves prior solver behaviour.

The reproducible `uplift-belt` scenario in the existing runner uses D=1 m²/year as an uncalibrated choice. Maximum height ~1045m; the same no-diffusion trial reached ~999m because transport changes subsequent routing and incision, not merely a final image blur. The fixed-boundary reservoir imports about 23.5 million m³ in this experiment (negative signed export), explicitly accounted for rather than hidden. Flat surroundings and regular drainage are still visible. This scenario is not accepted as plausible planetary terrain.

Additional research: Schott et al. 2024, DOI https://doi.org/10.1145/3658200 and the authors' https://h-schott.github.io/p/mserosion/ . The public MIT implementation https://github.com/H-Schott/MultiScaleErosion was read (README plus erosion/thermal/deposition shader stages), not installed or executed. Its workflow alternates erosion, thermal transport/deposition and resolution amplification. The complete paper could not be read through the available HAL/ACM pages; no full-paper reproduction or adoption is claimed. This supports investigating several processes and scales, but does not solve our planetary boundary conditions. The independent paired-transfer helper is not a port of those shaders.

### Actual planetary input, with identity and datum preserved

`planet-relief-input.mjs` now connects a verified saved base to a bounded metric input window and then to the independent solver/canonical terrain format. It retains the original base ID, derived-source ID, source cells/outlets, projection, metric offset and vertical datum. `coarse-only` intentionally removes old procedural bands and local river/pond effects in an identified COPY; `saved-surface` keeps the original source. The land-only experiment refuses sampled marine/wet or unresolved source locations. That screening is finite and applies to the derived source, not a continuous proof or preservation of removed local water. Uplift/erodibility must still be explicit independent inputs; elevation or a landform label is not evidence of either.

Reproduce with `node --max-old-space-size=256 scripts/experiments/run-planet-relief.mjs SOURCE_JSON OUTPUT_DIR LAT LON [EXTENT_M]`. The runner writes actual input, canonical output and report into a fresh directory and refuses existing outputs. It validates the base identity, not unrelated settlement state in a containing planet-world file.

Two actual 50km, 129² windows from base 7de4f2cb… were run at (56.2579614,73.1766754) and (47.8210815,-104.0244038). Old river corridors are no longer pinned in these input experiments. Under explicit uniform uplift/incision/diffusion, the first changes by at most ~285m upward/~3m downward; the second ~172m upward/~343m downward. Final routing has no uphill edges in these two selected cases, but the plots still show artificial square-boundary influence and strong diagonal direction patterns. The coarse inputs are almost single smooth slopes over 50km; the missing intermediate hierarchy cannot be called solved by adding these local effects. These outputs are UNADOPTED. No saved planet, water network, climate, road or settlement was rewritten.

Four focused input tests cover original/derived identity, exact source ownership, deterministic outputs, datum/projection provenance, explicit forcing, marine/unknown rejection, stale identities and work limits. Together with the solver and crop checks, 22 focused tests pass. The last full-suite checkpoint remains 953 passes at 7726dce; this input-only follow-up has not yet had a fresh full-suite run. Actual reports and rejection reasons are appended to the existing independent-relief report rather than presented as a new finished generator.

### Shared valley skeleton before surface evolution

The `drainage-envelope.mjs` research input path constructs ONE initial field from an explicit downhill tree. For each linear-height segment it minimizes segment elevation plus a cross-slope distance cost, then takes the lower envelope across segments. This is an independently derived geometric construction, not a reproduction of Génèvaux et al. 2013 or inferred planetary geology. The supplied 40-node fixture is an explicitly synthetic Euclidean tree, not an extracted Earth river map or a planetary drainage graph. Tree validation rejects cycles, isolated nodes and invalid longitudinal slopes. A 33-point-per-edge audit reports competing segment undercuts; it is a finite diagnostic, not a proof of continuous hydraulic compatibility.

`run-drainage-relief.mjs fixtures/drainage-skeleton-research.json NEW_OUTPUT_DIRECTORY` runs the shared input through the existing research solver and canonical terrain format. It saves the complete real input and output, skeleton identity, explicit outlet nodes and origin. This also fixes a provenance omission: explicit solver outlets previously affected the simulation but were not retained in the canonical parameter record. Sorted duplicate-free outlets now survive saving, with stable identity independent of supplied order. Old default-boundary outputs retain their existing representation.

The actual 20km, 129² scenario fixes only the declared outlet (node 64); other external edges are closed to external hillslope flux. It yields about 799m relief. The earlier trial that fixed every high perimeter node produced an artificial square wall as its interior eroded; it is rejected. The single-outlet result has more legible ridges and valleys, but still shows grid ribs, synthetic topology and an artificial outer boundary. Its final drainage graph has 2 uphill edges, and the evolved drainage is not asserted to preserve the initial channel skeleton. Neither the graph nor blue shading is a water surface. This remains UNADOPTED, without planetary boundary coupling or browser acceptance.

Four new focused tests cover geometric ownership/order, shared overlapping sample coordinates, invalid topology/constraint conflicts, and the actual CLI input/output/provenance/no-overwrite path. Combined solver/input/crop tests: 27 passes. Fresh full-suite verification on this checkpoint: 962 PASS, 0 FAIL, 0 SKIP (331.8 seconds), using one worker and a 256 MiB Node heap. Numerical crop checks on the actual output and full parameters are appended to `reports/independent-relief-solver-2026-10-11.json`.

Additional cliff-specific primary reference: Paris et al. (2020), *Modeling Rocky Scenery using Implicit Blocks*, author page https://perso.liris.cnrs.fr/aparis/public_html/projects/paris2020_Blocks.html and author release https://github.com/aparis69/Rock-fracturing . The author abstract models fractured rocky walls with volumetric implicit blocks; this addresses a different scale and representation than the regional height field. The release README explicitly says it was rewritten separately from the original internal implementation, omits implicit replication and periodic/aperiodic tiling, and may differ in results/timing. Only the author page and README/license listing were inspected, not the full paper or a working integration. Nothing was installed, run or copied. A height field can represent steep finite slopes, but vertical overhangs require additional geometry and compatible collision/surface queries; decorative rock meshes alone would not establish one authoritative terrain. This is an identified future representation boundary, not a reason to postpone the currently missing regional relief.

### Routing graph versus actual ground runoff

The skeleton runner now reuses the existing `delineateGridCatchments` implementation on its REAL final canonical heights. In the actual 20km fixture, the basin-graph route connects all nodes to its declared outlet, but strict downhill D8 reaches that outlet from only 155 / 16,641 sampled cells (~0.93%); the same ground has 3 discrete sinks. The two uphill connections rise by 0.2673m and 0.3648m, so these are not floating-point roundoff. Their potential graph areas are about 402.49km² and 156.88km². Those values are routing bookkeeping, NOT physically delivered runoff. The existing catchment code also correctly marks the result partial because it touches the survey edge. Overflow/storage could connect real water later; absence of those processes must remain explicit rather than calling the graph a valid river system. Small depressions may be real features or numerical artifacts; this audit alone cannot decide which, and it neither fills nor breaches them.

`report.json` retains both interpretations, bounded first-uphill-edge details, and the strict-ground diagnostic. If the existing catchment module's 65,536-node budget is exceeded, the diagnostic explicitly reports not-run. No terrain value, output identity, water field or current world changed in this follow-up. All 27 focused checks pass; the 962-pass full-suite checkpoint is 85b6a17, before this diagnostic-only runner follow-up.

### Irregular mesh comparison and independent solver

A coarse-to-fine raster trial (33 → 65 → 129 → 257) still produced strong regular ribs, despite ending with zero uphill graph edges. The triangular-grid option was then checked against the documented Fastscapelib catchment workflow (https://fastscapelib.readthedocs.io/en/latest/examples/catchment_py.html and https://fastscapelib.readthedocs.io/en/latest/guide_grids.html). The existing external GPL library remains only an isolated benchmark, never a bundled runtime dependency or copied implementation. Both benchmark branches use the same analytic skeleton and erosion forcing without diffusion; they differ in sample locations, mesh connectivity and node areas, so this is not a controlled test of routing direction alone. The actual triangular output shows substantially fewer regular ribs in these inspected CPU plots.

`mesh-relief.mjs` independently reuses the existing basin-graph algorithm with explicit metric edge lengths and lumped triangle areas (one third of triangle area per vertex). It validates counts, indices, orientation, degeneracy and edge incidence, but does not claim an all-pairs geometric intersection proof for caller-supplied triangles. It does not silently pretend to implement hillslope diffusion on the irregular mesh. Actual 16,641-node evolution takes about 2.2 seconds in this environment and ends with zero uphill edges on its SOURCE mesh. Against the external reference on the same points, RMS height difference is 9.94m and maximum difference is 103.4m. Area conventions and routing differ; no bit-identical reproduction or Earth calibration is claimed.

The reproducible input maker uses fixed-seed NumPy sampling and SciPy Delaunay solely during generation, then saves the actual mesh. Commands are recorded in the report. Rebuilding the input reproduces mesh ID fd003394… in this environment. The runner saves input.json, mesh.json, report.json and terrain.json. No source planet or settlement moves.

A bounded spatial index and barycentric sampler convert the result into the existing canonical C1 format and actual viewer restoration path. This is explicitly LOSSY: at a 257² raster, the maximum difference at the original 16,641 mesh vertices is 30.99m. The final raster is a distinct, identified authoritative surface; it is not asserted to preserve source-mesh drainage. Original outlet indices are retained under meshSource, never mislabelled as raster indices. This exposes a real representation gap: retaining exact mesh geometry for near-field queries will need an authoritative mesh adapter rather than assuming raster resampling is exact. No planet/browser/water acceptance is claimed. The result is still UNADOPTED.

Verification of the independent mesh checkpoint: 32 focused passes, 967 full-suite passes / 0 failures / 0 skips (286.2 seconds), and build verification passed. These are implementation checks, not visual, hydraulic or planetary acceptance.


### Canonical triangular surface: preserving source geometry

The 30.99m reconstruction error is now avoided by retaining the actual mesh as `minimal-world-triangular-terrain@1`. `triangular-geometry.mjs` is the single shared geometry implementation for the research solver and runtime adapter. It stores explicit points, triangles and elevations, with bounded indexing and no random or LOD-dependent generation during queries. Existing raster snapshots remain supported unchanged. The metric scene loader accepts the new schema; this does not imply the globe renderer already uses the mesh directly.

`triangular-terrain.mjs` provides saved/validated identity, owned snapshots, metric samples, analytic triangle-face gradients, normals, regular preview windows, and segment traces with triangle-edge intersections. Normals on a crease are explicitly one-sided; curvature is undefined rather than falsely reported as smooth. `toMesh()` returns the exact triangles for a renderer. Preview grids never replace the authoritative saved surface. Water remains unresolved, not dry by assumption. Invalid or missing coverage raises an error instead of invented extrapolation. Overlapping supplied triangles are outside the contract; topology validation is not an all-pairs overlap proof.

Actual 16,641-node / 32,768-triangle output was saved and restored, with maximum original vertex error 0m, centroid error 1.71e-12m, and edge-midpoint error 1.14e-12m. Saved world ID is `cf6cc30457559a7b4534b0dc54668f28c4273daa3249642ae3fcb42246622f4f`. These are finite checks of the piecewise-linear geometry, not proof of physical realism. The earlier raster remains separately exported as `raster-preview.json`, including its 30.99m loss. `terrain.json` now retains the canonical triangle surface. Reproduction uses the runner and `verify-mesh-canonical.mjs`; outputs refuse overwriting.

No source planet, settlement, main branch or hydrological truth has changed. Whole-planet embedding, basin boundary reconciliation, renderer integration and browser acceptance remain open. The immediate gain is that subsequent integration can consume the solved surface without silently flattening its ridges through a grid conversion.

Verification: 11 focused tests and 973 full-suite tests pass, 0 failures / 0 skips (322.7 seconds), build passed. The actual 1.54MB scene was loaded, exported and reloaded with the same identity; its inspector reads the exact ridge elevation and reports water unknown. No browser screenshot or WebGL success is claimed.


### Bounded exact near-field geometry windows

`meshWindow()` clips the saved triangles to a requested metric rectangle using the existing spatial index. It never resamples a raster, smooths vertices, changes world identity, or fills a missing triangle. Output is bounded (8,192 triangles by default); over-budget calls fail explicitly rather than dropping faces. Shared-edge intersections use consistent endpoint ordering. Piecewise-linear creases remain real creases; the UI inspector now exposes the one-sided gradient status instead of hiding it.

Actual test: 64 windows of 2km × 2km across the saved 20km domain yielded 28,101 clipped triangles in 473ms in this run. Maximum window size was 457 triangles / 85,597 JSON bytes. Maximum centroid height discrepancy was 9.67e-13m; maximum area discrepancy from 4km² was 5.13e-9m². These finite checks describe this full-coverage generated source, not arbitrary supplied overlapping triangles. The reproducible mesh verifier now includes the 64-window check. A CPU plot of one exact 2km window was inspected and shared at 2× vertical emphasis. Its visibly coarse triangular faces are acknowledged, not called finished natural close terrain.

This API supplies exact near-field geometry for rendering; the current globe tile pipeline still needs an explicit geographic/LOD integration. Regular preview sampling remains a display approximation and cannot replace this canonical geometry. Nothing moves when the camera changes.


Window checkpoint verification: 13 focused tests, 975 full-suite passes / 0 failures / 0 skips (309.8 seconds), build passed. Five additional Python importer tests passed separately.

### Earth reference data through the same geometry contract

The acquired GSI Numata and Byobugaura DEMs can now be imported into the same canonical triangular adapter, rather than used only as external pictures. `import-earth-reference-mesh.py INPUT_NPZ MANIFEST_JSON SITE NEW_INPUT_JSON --stride 4` retains the manifest/source URLs and license, input SHA-256, sampling interval, missing-data counts and limitations. In this actual import, approximately 15m point sampling was used from the decoded tiles (not an assertion of improved source resolution or antialiased downsampling). Every coarse cell whose underlying original support includes NoData is conservatively omitted. No blank area becomes water or flat terrain. Approximate local pixel scale is inherited from acquisition; no geodetic or vertical-datum conversion is claimed.

Numata: 36,334 vertices / 71,186 triangles, canonical identity `b9a6d326c8b11b2d6f01fe7817e73715b70b937e63bac3aad763d6e9a00a042e`. Byobugaura: 32,160 vertices / 63,286 triangles, identity `fff043235da64e749e44ecf84bf40e702c04af19f0c3e97c4e9cd2ad35f84588`. All retained vertex heights reproduce exactly in both cases; the actual metric loader and saved-identity restoration accept both. Raw rasters and generated reference meshes remain outside Git. These are real reference surfaces, NOT generated worlds and not automatic planetary adoption. The purpose is to make terraces and coastal cliffs available under the same inspection contract for subsequent comparisons.


### Geographic coordinate binding and existing renderer packets

`src/globe/triangular-patch.mjs` binds a saved canonical triangle surface to an explicitly supplied spherical projection and metric origin. It retains the source world ID and creates a separate, deterministic geographic view ID. No surrounding terrain, boundary blend, sea or settlement is inferred. Geographic queries read the same canonical mesh; antimeridian and polar round trips are checked. This is a bounded regional view, not a declaration that the region has been adopted into a whole planet.

`buildTriangularPatchMesh()` converts exact clipped faces into the existing `GlobeRenderer` buffer layout, with local ECEF anchors, explicit height-lift vectors and identical fine/coarse positions. Thus parent-grid morphing cannot flatten the source ridge. Native index budgets are enforced (at most 21,845 triangles per packet). Face normals preserve the piecewise-linear creases. The finite centroid chord error is recorded as UNCERTIFIED; it is not passed off as a cube-LOD error certificate.

Actual 20km source, explicitly bound at 40°N / 179.999°E on a 6,371km sphere for this coordinate test: 16 draw windows, maximum 520,812 buffer bytes per window, maximum float32 position error 0.000169m, maximum sampled centroid chord error 0.00246m. The existing GPU upload/disposal code accepts the buffer layout under a mocked WebGL contract; this is not an actual GPU driver test.

`render-triangular-scene.mjs` runs the existing production `SoftwareRenderer` and `createOrbitCamera`, saving a real PPM framebuffer plus its report. The inspected and shared 1100×700 CPU image uses a 2km window, true vertical scale, 430 source triangles / 407 visible triangles, 95,460 buffer bytes, and roughly 112ms for that single diagnostic draw. This is not a frame-rate guarantee or browser screenshot. Global patch ownership, adaptive cube-tile stitching, and hydraulic/environmental regeneration remain unimplemented adoption requirements. The apparent triangular coarseness is acknowledged rather than hidden through display smoothing.

Verification of geographic renderer connection: 3 focused tests, 978 full-suite passes / 0 failures / 0 skips (262.3 seconds), build passed. Reproduce the saved diagnostic with `render-triangular-scene.mjs TERRAIN_JSON fixtures/triangular-relief-view.json NEW_PPM NEW_REPORT_JSON`; the fixture checks the expected source world identity.

An actual pair of adjacent 5km draw windows shared all 78 inspected boundary vertices. Their ECEF float32 packet discrepancy was at most 0.000232m after separate local anchors. This is a finite equal-window seam diagnostic, not proof for arbitrary mixed LOD or independently generated catchments. The saved fixture reproduced the CPU framebuffer byte-for-byte.


### Regional viewer entry and interruption handling

`src/globe/relief.html` is linked from the existing globe page. It opens saved triangle JSON, uses the existing WebGL renderer or bounded CPU fallback, and exposes heading, tilt, distance, display-only exaggeration, reset, renderer recovery and diagnostic-record download. Technical source/view identity is folded away. It explicitly labels the view as a regional inspection before whole-planet integration, and does not invent ground in missing-data regions or surface water. A reusable input/reproduction recipe is in `scripts/experiments/README.md`.

Input is capped at 16MiB and new draw buffers at 32MiB. Preparation uses 16 metric windows and yields every 128 emitted triangles as well as between windows, keeping the heavy packet loop cooperative. The synchronous CLI and cooperative browser paths drain the same generator and produce identical buffers. Initial JSON validation/index construction remains synchronous and bounded; this is not a guarantee of zero input latency on all devices.

Actual synthetic source through the UI preparation and production CPU path: 16 packets / 8,034,180 bytes, 56,215 painted pixels at 500×325, source identity unchanged, draw buffers return to zero after disposal. Both actual GSI reference sources prepared successfully (about 16.8MB Numata / 15.0MB Byobugaura draw buffers). Those elapsed times are cloud observations, not browser performance promises.

The actual page module was exercised with an instrumented DOM/event harness: valid load, display-only exaggeration, malformed-file preservation, late/stale file reads, injected upload failure, retry, and persisted page navigation. Static HTTP requests returned the actual page and its module resources with correct MIME types. These are useful integration checks but are NOT actual browser, native picker, mobile layout or WebGL driver acceptance. Previously verified cloud browser restrictions remain unresolved; no alternate route has been used to bypass them.

Final regional-view checkpoint: 984 full-suite passes / 0 failures / 0 skips (272.0 seconds), 9 focused page/session/packet checks, build passed (122 core, 30 legacy aliases, 50 globe modules). The actual native CPU framebuffer remained byte-identical after cooperative packet generation. Browser acceptance is still not claimed.

### Material columns and bounded generation density

The mesh research solver now accepts owned per-node uplift/erodibility fields and optional sharp material columns. Contacts are in initial material-height coordinates and advect with cumulative uplift; crossing a contact consumes implicit time before using the next material. At most eight contacts are accepted. Identical adjacent materials are collapsed so an artificial label cannot introduce a numerical step. The original scalar case and saved canonical world remain byte-for-byte identical.

Research basis: Barnhart et al. (2019), Terrainbento, DOI 10.5194/gmd-12-1267-2019, section 3.7.2 and equations 49–50, read from the original paper. It varies erodibility according to surface height relative to material contacts and uses a smooth transition zone. Our independent sharp-contact split approximation is deliberately distinct; no source code was copied and no Terrainbento dependency was added. No full-paper/model reproduction or calibrated geology is claimed.

`run-mesh-materials.mjs` saves actual input, output and diagnostics for three controlled material cases. `make-relief-mesh.py` now accepts a bounded odd node count (3–255), extent and seed; defaults reproduce the original mesh. Resolution is a generation choice, never a camera-triggered mutation.

Actual 129-side / 16,641-node outputs: uniform maximum height 770.47m; resistant upper layer 2670.95m; intermediate resistant band 807.99m. The band has four raw uphill routing comparisons, each only 1.1369e-13m. An initial user update treated their count as a physical drainage failure; that interpretation was corrected immediately after measuring the differences. Reports now retain the raw count, maximum rise and count above a stated 1e-8m diagnostic tolerance. This tolerance is not a physical lake/overflow model.

A second actual generation at 193-side / 37,249 nodes was compared at 4,225 common coordinates. Mean absolute height differences were 20.38m (uniform), 33.15m (upper layer) and 14.95m (band); maxima were 217.68m, 702.72m and 461.78m. These are independently jittered meshes, so topology and drainage discretization change too. The experiment is NOT evidence of convergence. See `reports/mesh-material-comparison-2026-10-11.json` for full actual input parameters, source IDs and measured reports.

The existing production CPU renderer rendered the same 2km window of all three dense sources at true height. Images were inspected and shared. The upper-layer case retains a steep valley, but the band is almost featureless in the inspected window. Extreme flat benches, narrow walls and insufficient hillslope processes remain visible problems; more nodes alone do not fix them. No browser/GPU acceptance, whole-planet adoption, sediment transport, rockfall or hydraulic validity is asserted.

Verification: 990 full-suite passes / 0 failures / 0 skips (273.3s), 11 focused mesh/material checks, and three actual Python mesh CLI checks (repeatability, seed/boundary behavior, invalid input and no-overwrite). The actual scenarios were rerun after adding tolerance diagnostics; original scalar output identity was rechecked.

## 2026-10-12: 初回確定した水系の疎さを調べ直した結果

実物のゼロ人口世界を使った追加診断。既存の保存結果は変更していない。
本流 `river:926:861` は20 km表示では蛇行しており、近景で直線的に見えることだけを
根拠に「蛇行がない」と判定してはいけない。一方、幅と曲がりの反復、小河川の疎さは残る。

同じ地点の64 m間隔の調査を、129×129点から255×255点へ広げた。
前者の境界未解決流域は175、窪みの処理待ちは5、採用候補は5セル。
後者ではそれぞれ380、29、17セルだった。面積が増えたため件数をそのまま
良否比較しない。境界未解決に分類された集水面積は約52.3 km²から207.2 km²へ増え、
調査を広げるだけで解決する問題ではなかった。詳細は既存の
`reports/unpopulated-water-runtime-audit-2026-10-12.json` の `catchmentFollowup`。

重要なのは、未描画の水系の多くが「水がないと確定した土地」ではなく、
「区域外からの集水・窪みの扱いが未解決なので採用を保留した土地」であること。
保留判定を消して青線を増やすことは解決にしない。

### 研究との対応と採用範囲

- Derzapfほか2011『River Networks for Instant Procedural Planets』は、粗い惑星と水系を
  先に作り、近づいた部分を詳細化する。広域の接続を残した詳細化を参考にする。
  今回は著者公開PDFの検索索引にある概要・第3節を確認。PDF全体の取得は失敗した。
  https://www.bjoern-ganster.de/pdf/planets.pdf
- Fischerほか2022は人工流域から川と湖を決め、その周囲の地形を成長させる。
  既に固定した地形に後から流路を押し込む限界を考える材料になるが、既存保存地形を
  置き換える許可にはしない。著者公開資料の検索索引にある手順を確認、全文取得は失敗。
  https://cgvr.cs.uni-bremen.de/papers/cgi22/CGI22.pdf
- Davis2026のプレプリントは区域ごとの遅延生成・キャッシュを扱うが、本文は川が
  プレート境界を越えない制約を明記する。保存単位の参考にはなるが、今回必要な
  区域間をつなぐ流域の解決策としてそのまま採用しない。HTML本文を確認。
  https://arxiv.org/html/2610.00301v1

次の接続設計では、広域の排水先と区域境界での受け渡しを親の条件として保持する。
局所流路・岸の形は初回参照時に選び、保存した結果を再利用できればよい。
初回の形を一意にするためだけの計算は要求しない。隣接区域の接続条件と既存の
確定済み結果を守ることが必要である。この接続設計はまだ実装済みではない。
