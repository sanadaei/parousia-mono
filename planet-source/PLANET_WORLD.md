# Generated planet integration (work in progress)

## 2026-10-10 04:20 UTC 更新

新規生成は @16。道路同士の法面が切り替わる実段差を、車道を固定する連続混合へ修正した。
旧@15以前の保存は自動変換しない。新規5世界の地形・河川・家屋・道路の統合は再検証済み。
直下の@15記録はその版の測定であり、新版の実画面性能と同一視しない。


Updated 2026-10-10 JST. Source baseline: sanadaei/planet main
`69bb357d5bc95ef7c12e90dcc4cec59d5a9a851c`. Imported files matched the upstream
Git tree `63addb4156b8ae45eeac6382ed6eb77f206deb0a` (889 files).
This document describes the current cloud implementation, not a completion claim.

## Current state (2026-10-10, generator @15)

The default immutable package currently contains 8 settlements, 9 overflow lakes,
an explicit sea at 0 m and 39 accepted global river profiles (1,827 points,
0 rejected links). Its declared valley incision budget is 600 m and side run/rise
is 3; this budget is not an assertion that all valleys are physically natural.
Five saved examples include terminal-lake and below-sea enclosed-basin cases.
The latest five-world re-generation audit produced 259 / 166 / 193 / 196 / 245
houses, checked 80,840 road cross-section points and 69,666 river points, and
reported zero rejected river links for those five inputs. All river samples
matched the paged runtime exactly; road surface differences were below 3.8e-9 m.
These are actual finite checks in `examples/planet/verification/integration.json`,
not a continuous hydraulic or structural guarantee.

- Implemented: generation and restoration, common world/feature identities,
  global-to-ground streaming, road/house/bridge meshes, road crown, shared water,
  finite-grid rain/pipe experiments, wheel-support and sprung-body experiments,
  explicit-input beam/foundation assessments.
- Verified: actual input/output comparisons and browser navigation/recovery;
  see the current evidence inventory in HANDOFF.
- Not accepted yet: 2-pixel conservative displayed-ground accuracy, sustained
  30-fps WebGL performance on actual GPU hardware, and all-device visual quality.
  The available cloud browser uses the CPU diagnostic path.
- Model limits: rainfall/evaporation equilibrium, momentum/erosion, unresolved
  subcell drainage and unknown soil properties are not inferred automatically.
  Old saved worlds keep their original arithmetic and C0 policies.

The sections below are chronological development records, including earlier
100 m incision presets, rejected links and earlier test counts. Those older
figures do not override the current package above.

## Run

- Node >= 22, no third-party runtime dependencies.
- `npm run planet:generate` creates the default planet and its paged render pack.
- `node scripts/generate-planet.mjs another-seed examples/planet/another` creates another world.
- `npm run ui`, then open `/src/globe/index.html`.
- Default generated world: blue sea, continental land, explicit lake levels,
  eight ground-constrained settlements, actual walls/roofs, roads and bridges across the same global river network.
- Select a settlement to fly to it; wheel zoom, drag pan, Shift+drag tilt.
- Save/restore camera buttons are bound to the exact packaged world identity.
- `?renderer=software` is an optional low-resolution CPU diagnostic path for
  machines without WebGL2. It displays actual shared meshes, not a mock scene.
  Its draw FPS is measured separately and cannot pass a GPU performance gate.
- `npm test` runs serially under a 256 MiB child heap and checks free memory.
- `npm run verify:planet` records actual input/output for five generated worlds.

## One world, several layers

`generatePlanet` produces the canonical base terrain, fitted metric feature
recipes and stable settlement IDs. `snapshotPlanetWorld` hashes geography,
water, roads, houses, settlement locations and focus. `restorePlanetWorld`
validates this complete identity and exposes composed samples. Camera and tile
caches are not part of the world. Old snapshots without explicit sea metadata
remain hydrologically unresolved; zero elevation never silently becomes sea.

Generation uses seeded spherical terrain noise and a bounded priority-flood
receiver graph. The largest connected sub-sea source-grid component is the
explicit ocean. Depressions receive identified static lakes. A prescribed
`lakeFillFraction < 1` creates terminal-lake scenarios; this is not a computed
rainfall/evaporation equilibrium. All receiver paths are acyclic.

Settlements are selected using dryness, slope, altitude, catchment contribution
and geographic separation. Lots vary in spacing, setback, size and height;
footprints with unacceptable slope or overlap are rejected. These remain
small road-oriented hamlets, not a full urban morphology or population model.

Major rivers now have shared spherical profiles independent of local charts.
The default seed fits 38 long-distance receiver links (1,748 profile points),
with one rejected link recorded because its sampled incision exceeds 100 m.
Shared node levels, downhill profiles, resident sampling, paged sampling and
save restoration are checked. Settlement bridges now reference these same profiles rather than creating
separate decorative local streams. Three of the default eight settlements
are river-bank sites. Rejected global links still prevent
a claim of complete source-to-sea continuity.
The 100 m incision limit also bounds queries between fitted profile points;
51,981 intermediate centerline probes across four worlds remained wet and
matched paged ground/water queries exactly. Full hydraulic acceptance is still
outstanding; the explicit rejected links are 1 / 1 / 5 / 6 for these seeds.

## Evidence and fixes

`examples/planet/verification/integration.json` includes four input seeds,
world identities, actual geographic/metric queries and returned samples.
The most recent run produced 151 / 98 / 104 / 106 houses, with 10,605 / 10,620 / 10,610 / 10,625 road
cross-section probes respectively. The minimum sampled deck-to-water clearance
was approximately 2.682 m after deck thickness. This is fixed probing, not a
continuous structural or hydraulic proof.

The cloud browser has no WebGL2. The CPU diagnostic showed sea/land and actual
houses at settlement zoom. It exposed two integration defects that numeric
point tests alone missed:

1. Single-chart fill was incorrectly minimized against natural ground whenever
   namespace handling was enabled. It now preserves both fills and cuts.
2. A water feature could be queried as wet while a coarse render triangle
   covered its water. Refinement now prioritizes water and budgets detail by
   channel width. A ray/triangle regression checks the actually displayed mesh.

Narrow roads and river water strips also have persistent geometry built from
the saved feature recipe. No independent road or building definition is used.
Absent building pages are cached; failed requests back off; body transfers have
finite deadlines. Planned neighboring terrain tiles use 2:1 balancing within
the request budget. One-level edge stitching uses the same parent positions as
morphing. Displayed transitions are separately audited and not assumed balanced.

## Runoff and road checks

`inspectRoadCorridorClearance` intersects complete straight road footprints,
including parallel overlaps missed by centerline-only checks. Linear profile
clearance uses polygon extrema; cubic profiles use conservative intervals.
Turning vehicle envelopes and structure strength remain separate.

`runoffFromTerrain` takes the actual earthworked metric sampler into a fixed
simulation grid. `stepRunoff` performs conservative head-driven reservoir
routing with rainfall, infiltration, embankment barriers and capacity-limited
culverts. Stable internal time steps, nonnegative water and mass balance are
checked. Boundaries are closed. It does not solve momentum, turbulence, erosion
or general shallow-water dynamics and is not yet an animated globe layer.

`submergedPipeFlow` balances full-barrel Manning friction and explicit entrance/
exit losses against upstream/downstream reservoir heads. Partially filled
barrels return an unsupported state, not a fabricated capacity. The model is
informed by [FHWA culvert hydraulic guidance](https://www.fhwa.dot.gov/engineering/hydraulics/culverthyd/)
and [HEC-RAS hydraulic computation documentation](https://www.hec.usace.army.mil/confluence/rasdocs/rasum/7.0/entering-and-editing-geometric-data/bridges-and-culverts/culvert-hydraulic-computations).
The implementation is a bounded game model, not a certified real-world design.

## Remaining gates

- Continuous large-area river geometry and lake/sea shoreline integration.
- Riverbed/bank C1 behavior at every junction, not only smooth outside banks.
- General post-earthwork hydraulic regimes and automatically sized culverts.
- Structural material/load resistance and turning swept vehicle envelopes.
- Feature/waterline error certificates and displayed-morph edge quality.
- Fast camera-follow under constrained loading, long-duration memory and actual
  WebGL context-loss recovery/performance across devices.
- Human naturalness acceptance. It remains unclaimed and does not block other work.

### Legacy verification on this runtime

The 312-test checkpoint and build passed on Node v24.19.0. The old separate-
process witness gate uses exact floating-point equality and failed on this
runtime, first on a gradient difference of about 1.4e-14. The unchanged upstream
snapshot produces the same failure. A separate comparison of 40 old worlds and
8,819 saved samples/frames found the changed implementation exactly equal to the
untouched baseline on this runtime. Maximum difference from stored historical
numeric witnesses was about 4.45e-10. Original files were not rewritten and the
strict gate was not relaxed or declared passed. See `baseline-comparison.json`
and the two `*-strict-failure.log` files in the verification directory.

## Canonical road display curves

Persistent road surfaces now use the same cubic vertical profiles as Core.
An analytic second-derivative bound limits linear display interpolation to
5 mm vertically, with at most 5 m station spacing and a bounded mesh budget.
This removes the earlier endpoint-only straightening of hills and approach
curves. The error bound is in the local metric vertical profile; spherical
projection and floating-point render errors remain separate.

## Real river-bank settlements

Generator revision 3 selects eligible banks beside existing global profiles,
aligns crossing roads with the channel normal, sizes spans to channel/banks,
and rejects house platforms whose earthwork batters could overwrite the road.
Inland sites no longer receive disconnected demonstration streams. The four
world audit caught a rotated approach-road/platform collision before the
conservative setback rule was added. River spatial lookup uses sparse ECEF
bounding boxes including bank width and arc sagitta; the regional displayed
river test dropped from about 24.6 seconds to 4.1 seconds on this machine.
These are two measurements, not a cross-device performance guarantee.

## Overflow paths, bridge bodies and displayed quality

Overflow lakes now emit river profiles at their actual spill outlets. Terminal
lakes do not. A bounded spherical corridor search can route around failed
direct fits without raising the incision limit. The default world resolves one
such route and still reports one infeasible link. The prescribed lake-fill
depth field now uses actual low-fill water levels rather than overflow levels.

Bridges now contain a deck, four longitudinal timber beams and ground-linked
pier/abutment boxes. The same saved design sets the road underside depth and
its elastic beam assessment. Synthetic game-material inputs and uniform plus
centred vehicle loads are explicit. Deflection includes bending and shear;
unknown inputs, excessive stresses/deflection and non-slender spans remain
distinct outcomes. This checks only the stated beam model, NOT real-world
construction safety or the whole bridge. Connections, decay, foundation
bearing/scour and support blockage of river flow remain outstanding.
Mechanics reference: [USDA Wood Handbook, Chapter 9, Table 9-1](https://research.fs.usda.gov/download/treesearch/37423.pdf).

The globe UI includes a bridge close-up selector. Stationary camera/unchanged
geometry reuses its LOD plan instead of rebuilding it every 180 ms. New uploads,
viewport or camera changes invalidate the plan. Runtime reports now separate
displayed base/morph bounds, limited feature refinement and water hidden during
morph transitions. These reports do not turn an unresolved feature/water error
into a passed base-terrain precision result.

## Close-up regression and bounded planning

An actual oblique bridge view exposed a planner defect: a final neighbour-
balancing collapse could remove the detailed view entirely (four coarse tiles,
maximum level 2). Refinements now commit only if their balancing closure fits
in the node budget. The reproduced near-bridge plan retains level 14+ at the
focus with zero planned 2:1 violations. Excavation bounds are downward-only,
and frustum/projection tests use the radial height interval rather than an
isotropic fictitious mountain. The camera's raw-base reference is separated
from the excavated channel bed.

LOD planning yields between refinement steps with a 5 ms target work slice;
individual steps can exceed that target and peak slice time is recorded.
There is one active plan and at most one replacement camera request. Ground
following uses one bounded main-thread page cache (reported separately), not
an extra Worker, and follows known water/road surfaces. Missing pages retain
the last reference until loading completes; this is not a continuous collision
certificate during unresolved loading. The cloud's CPU diagnostic visibly
restored the river and bridge at close range after the LOD correction.

The current automated checkpoint is 333 passing tests, zero failures. The
four-world report checks 459 houses and 42,460 road cross-section samples, plus
51,981 intermediate river samples. Beam checks refer to the explicit load and
material inputs only. Browser/Node structure comparison tolerates sub-micrometre
geographic rounding while keeping IDs, kinds and all nonnumeric design fields
exact; world-file integrity hashes remain exact.

## 実世界を使う固定格子の排水（2026-10-10 JST）

`createPlanetRunoffScenario` は保存世界そのものを復元し、村の造成・全球河川・家屋・橋脚を5m格子へ取得する。外周に元の世界の水位/地盤を使う固定水頭境界を置き、流入・流出・雨量・浸透を収支へ含める。描画LODから計算格子を作らない。入力は実際の worldId と共に保存し、`npm run verify:planet-runoff` で再生成できる。

`src/globe/runoff.html` は全球画面から開ける対話画面。8集落を選び、雨量を指定して10分ずつ進める。Nodeとクラウドブラウザーの両方で、既定村・50mm/時・600秒の実行を確認した。3600セルの最終水量は約7115.40837m³、Nodeの各60秒ステップ収支誤差の最大は4.8e-11m³。ブラウザーとNodeの最終量には約1.2e-8m³の浮動小数差があり、ビット一致とは主張しない。

これは貯留・線形水頭差による移送であり、運動量・侵食・波・洗掘の計算ではない。11本の橋脚は5mセルより細く、解像できない対象として明示する。橋面上と河道内の多層水流も未解決。3Dの静的水位を更新したと偽らず、同じ世界を入力にする別の物理実験として表示する。

## 車両の旋回時の占有域

`traceVehicleTurn` はホイールベース・操舵角・走行距離から、低速の自転車モデルによる車体中心の軌跡を作る。`inspectVehicleSweep` は長さ・幅・高さを持つ車体と、実際の家屋/屋根および橋の箱形状を比較する。端点だけの衝突判定ではなく、位置の円弧と車体回転の二階微分上界から膨張量を計算し、途中の全姿勢を包む凸多角形と高さ区間を使う。

衝突なしは指定した剛体運動に対する判定。包絡が重なる場合は「衝突の可能性」であり、実際の接触と断定しない。生成村8件の道路上から左右90度旋回して50m進む160例では54例で実在建物/橋との重なり候補を検出した。実入力・対象IDは `vehicle-sweeps.json`、再実行は `npm run verify:vehicle-sweep`。平面運動の検査であり、地面への支持・坂での車体ピッチ・滑り・牽引車はまだ保証しない。

河川の水位縦断は、将来の掘削下限を逆向きに伝播する区間充足法に更新した。早い段階で水位を下げすぎる貪欲法の誤却下を防ぐ。固定した端点や100mの掘削制限は緩めず、本当に成立しない経路は引き続き拒否する。

## ストリーミング中の境界・メモリ補修

計画時の隣接LODが2:1でも、読み込み順の異なる表示中のタイルには差が残る。実際の120秒ツアーで末尾20件の隣接違反を検出したため、表示集合についても保持済みの親へ限定的に戻し、2:1に整える処理を追加した。親がない場合は未解決として数える。細部が一時的に粗くなることはあり、モーフの全視覚品質が完了したとは扱わない。

固定されたキャッシュが満杯のとき、失敗した挿入が既存値を壊したり上限超過のまま残ったりしないよう、事前の容量確認を追加した。アップロードできないタイルには10秒の待機を設け、同じ重い生成を毎フレーム繰り返さない。

水面のインデックスを道路・敷地の表示から区別した。地形がモーフ中でも、正本の水位で水面を描く。以前のように全水面を意図的に非表示にする条件は除いた。ただし粗い地形に実水面が一時的に隠れる可能性は、地形/水際の誤差課題として残る。

追加の120秒クラウドCPUツアーでは、測定期間全体の隣接LOD違反0・地形全消失0・ストリーミングエラー0を確認した。2965フレームで表示用の一時的な親への退避が必要だったため、細部の追従が十分速いという意味ではない。実描画は約5.26fpsのCPU診断で、WebGLの30fps受入は未達/未測定。詳細は `browser-cpu-water-and-balance.json`。反復するキューブ隣接計算は2048件の固定上限付きキャッシュへ移し、その推定メモリも別に報告する。

`src/globe/vehicle.html` から実際の8集落に対する旋回範囲を確認できる。道路始点からの距離・左右・操舵角・車幅を変えると、同じ保存にある建物と橋のどれに重なる可能性があるかを表示する。地表への支持判定をこの画面の「重ならない」と混同しない。

## 湖岸の境界を実地形へ合わせる補修（生成版4）

追加監査で、旧セル所有＋1セルの周辺拡張が、乾いた尾根の反対側にまで同じ湖を割り当てる問題を検出した。既定世界では格子境界の左右約2cmで最大642mの水深差が出ていた。新生成では湖の候補を「実際の補間パッチを支える4個の元標本」に限定し、湖の流出口の節点にも同じ湖面高を与える。これでセルの四角形を湖岸にしていた問題と、出口の0.3mの段差を除く。

さらに別seedで、極の一地点を経度別の出口と扱う問題と、1.5m以下の微細凹凸が乾いた湖の縁を横切る問題を検出した。生成時に極側の標本列を同じ標高へまとめてから排水を導出する。微細地形には新しい明示方式 `anchored-spherical-shore-preserving@3` を使用する。指定した水位の近傍だけ、C1な滑らかな係数で残差を弱め、元地形が水位のどちら側かを維持する。水位から振幅の2倍以上離れると従来の微細地形と一致する。元標本は変えず、全球の全格子線を平らにはしない。追加の勾配上界もページ/投影の誤差計算へ含める。

旧保存にタグがない場合は旧所属方式を保持する。既存保存の同一worldIdの意味を勝手に変えない。補修は `planet-generator@4` で再生成した世界へ適用する。

4世界の湖周辺で、旧格子境界と補間パッチ境界の両方、計153,560組の左右を確認した。1cmを超える水深の段差0、未定義水域0。最大の左右差は約0.0002644m。両極では経度による水深差0。これは固定標本の監査であり、全地点のC1証明ではない。実入力・実出力は `shorelines.json`、再実行は `npm run verify:planet-shorelines`。

湖の選択メニューを追加した。元の世界を参照する12方向の岸までの距離から表示高度を選ぶため、小さい湖でも水面だけを拡大して見失わず、周辺地形と一緒に確認できる。

## 保存された排水通路と雨水移送の接続（生成版5）

`inspectEarthworkDrainage` の造成前の下り勾配検査から、道路/敷地の盛土を横切る通路を生成時に決め、`drainageRouting` として世界の保存・IDへ含める。復元時には参照する道路/敷地、端点、長さ、底高、係数を検証する。描画窓や雨水格子に合わせて通路を生成し直さない。旧保存は通路なしのまま保持する。

雨水計算は保存された端点を固定格子へ対応づける。範囲外、両端が同じセル、建物が占有する端点セルは理由付きで未接続にする。流れは既存の保存的な線形水頭差モデルに接続し、上限0.2m³/s・コンダクタンス0.2m²/sを明示したゲーム用係数として保存する。これは管径・材料・入口形状から算定した水理容量ではなく、部分充満/入口支配/管路の3D形状は未実装である。既存の満管公式だけを部分充満へ流用しない。

既定村の3通路を開いて50mm/時の雨を600秒与えた実出力は、総通過量7.8106934m³、閉鎖時との差は最大水深約1.01017cm。最終水量7113.3561643m³、各ステップの最大収支誤差4.37e-11m³。開閉とも同じ地盤・初期水・worldIdを使う。`runoff.json` に比較結果、入力/最終状態には全セルを保存する。

dotのクラウドブラウザーでも3通路が接続され、600秒後7113.3561643m³になったことを確認した。画面は黄色い線で接続を示し、「排水通路を開く」の切り替えで同じ初期状態に戻る。下流流域全体や全球の静的湖水位を更新したという意味ではない。

## 車両と同じ世界の地面・橋面との接続

`inspectVehicleSupport` は各姿勢の4輪位置で支持高を取得し、車体の前後/左右方向の平面を当てはめる。縦/横勾配、4輪のねじれ、車体下の標本による腹下接触、輪の位置の水深を別々に判定する。橋の上では河床でなく実際の橋面を使う。水深未定義も通行可にしない。

車体と建物の比較には、この平面の車体を包む保守的な鉛直箱を使う。姿勢間のその指定箱の包絡は検査できるが、標本間に存在する全地形との接触、タイヤの摩擦、荷重移動、サスペンション、転倒の動力学を証明したとは扱わない。今回は地上高0.2m、縦勾配0.3、横勾配0.2、輪の平面ずれ0.15m、渡渉深0.4mを明示条件とする。

8村160旋回の実入力に対し404,320地表標本を検査し、36旋回で支持条件外、68旋回で建物/橋との重なり候補を検出した。固定高度の旧比較54件とはモデルが異なる。入力・理由・勾配・最低腹下離隔は `vehicle-sweeps.json` に保存。クラウド実画面では既定の道路距離80mで支持条件外0、橋付近320mで133姿勢中119か所が条件外になったことを確認した。画面にも橙色の条件外区間を示す。

## 河川経路の未採用実験

河川接続の失敗を消すために掘削上限100mを緩めることはしていない。連続補間上の接続部の最高点を優先浸水の辺コストへ加える試作も行った。既定世界の却下経路は0になったが、湖の水位が変わり、現在の元標本による湖所属では湖岸の段差を再発させた。4世界で107/142/198/195組の1cm超段差、1/24/31/0組の未定義水域を検出したため採用していない。必要なのは接続経路だけの変更ではなく、連続地形上の濡れた連結領域も同時に再構築すること。この試作の成功した一指標だけを本実装の改善と扱わない。

## 読込Workerの故障からの復帰

異常終了したWorkerを永続的に使用不能のままにする不具合を修正した。旧Workerを終了してから同じスロットを作り直し、最大2個を維持する。連続失敗には1秒から最大60秒までの待機を入れる。起動15秒・処理120秒の監視期限を設け、遅れて届いた旧Worker/旧jobの出力は新しい仕事を解除しない。成功した仕事で失敗回数を戻す。画面上のメッシュは残し、読み込みの復帰と画面全体の破棄を分離する。

画面の「地形読込を再起動」も同じ2スロットを置き換える。これはGPUコンテキストの喪失とは別の復帰処理。GPUの実機受入は引き続き未確認。

GPUへの転送にも失敗時の巻き戻しを追加した。地盤の転送後に水面/地物側がメモリ不足になった場合でも、部分的に確保したバッファと完成済み地盤バッファを解放し、未完成タイルをキャッシュへ登録しない。モックGLで割当失敗・成功後解放・コンテキスト喪失時の無割当を検証した。これはGPU実機での性能測定ではない。

再試行のタイル記録は1024件を上限とし、期限切れを除く。失敗し続けるページを移動しながら読むことで、この記録だけが無制限に増える状態を防ぐ。

実画面120秒ツアー中に2読込Workerを手動再起動し、両方の復帰・地形全消失0・隣接違反0・最終エラー0を確認した（`browser-cpu-worker-restart.json`）。実描画は約5.13fpsのCPU診断であり、GPU性能合格ではない。

隣接均衡の途中にも処理を譲る場所を追加し、同期版と同じ計画になることを試験した。後続の120秒測定も全消失0・隣接違反0・エラー0だったが、最大計画処理片は約236.8msになった。5msは目標にすぎず、この変更で常時5ms以下や滑らかな動作を達成したとは扱わない（`browser-cpu-incremental-balance.json`）。

全球画面で選んだ集落と世界保存のURL/IDを車両・雨水画面へ引き継ぐ。旧形式で集落用の全体保存がない場合は、別の既定世界を勝手に開かずリンクを無効にする。保存内容が入れ替わってIDが合わなくなった場合も明示エラーにする。

## 河床の滑らかな接続（生成版6）

新規の全球河川には `c1-incision-pnorm16@1` を保存する。縦断の水位/幅/深さを端で微分0のsmoothstepで補間し、各球面線分の丸い端部を持つ河道から、C1の正部分関数で掘削量を作る。重なる掘削を硬い最小値で切り替えず、p=16のノルムで結合し、上限もC1のコンパクトな丸めで制限する。各成分は影響境界で値と微分が0になり、全成分0の場所にも滑らかに接続する。既存のC1な基礎地形を前提とする河床の契約であり、水位場全体や水系接続の証明とは区別する。

影響外の地形は完全に同一で、掘削は保存した100m上限を超えない。重なる河道ではわずかに深くなる。旧方式のタグなし保存は従来の計算を保持する。節点・河岸・端部・合流の左右勾配、影響外の一致、掘削上限を追加検査した。4世界の河川/道路・153,560組の湖岸・保存/ページ照合を再実行して成功した。旧40世界8,819標本も同じNode環境の元コードと一致する。

新生成の既定村での600秒雨水試験は7112.1465948m³、開放通路の総移送7.8106666m³、収支誤差最大3.19e-11m³。河床が変わったので、以前の生成版の数値をそのまま現行値とは扱わない。

## 終端湖の干上がった底と近接表示（生成版7）

低水位の終端湖では、元の満水時の流出先を露出した湖底が保持していた。残っている実際の湿潤セルを起点に、元の流域内部だけで排水方向を再構築し、流量集計前にDAG順を再計算する。水のないセルへ湖の低い水位を強制する処理も廃止した。極付近の球面迂回を一律禁止せず、緯度に応じた分割長で索引の条件を保つ。planet-terminal / lakeFillFraction=0.6 は196河川経路受理・却下0、他3世界には計4区間の却下が残る。153,560組の湖岸検査は未定義0・1cm超段差0。掘削上限100mは変更していない。

LOD均衡を画面内のタイルだけへ施すと、画面外の必要な兄弟タイルが粗すぎて表示段階で近接地形をL2まで戻し続けた。全6面の必要葉へ隣接均衡を施すよう修正し、クラウドCPU実画面で実在する橋をL18・114表示タイル・隣接違反0まで拡大、川と家屋を確認した。細部の読込には約60–80秒かかり、高速な追従を達成したとはしていない。

起動用に StartPlanet.cmd / start-planet.sh / npm start を追加した。Node22以上だけで保存済み世界を直接開き、ビルド・生成・外部依存インストールを起動時に行わない。使用中ポートは最大10候補で回避する。Linuxで通常起動、使用中ポート、失敗処理を検査した。Windowsのバッチ実行は未確認。全384試験0失敗、build、4世界統合、雨水、160旋回、旧40世界8,819標本の同一Node比較を通過した。

## 円形排水管の流量への接続（生成版8）

保存した流入口/流出口と長さに、直径0.4m・Manning粗度0.015・入口損失0.5・出口損失1の明示した施工プリセットを付与した。道路や敷地と無関係な別の配管網は生成しない。直径は流域の設計豪雨から自動選定した値ではない。新方式は保存契約を版2へ進め、旧版1の0.2m³/s上限・0.2m²/s係数は従来どおり再生する。

満管では、両端の水位差を入口/出口損失とManning摩擦損失へ配分するエネルギー式から流量を得る。部分流では円形の濡れた断面と上流水深に基づく入口エネルギー上限・管内摩擦上限の小さい方を使い、出口の水没に合わせて入口の自由流出上限を滑らかに解除する。この移行則と部分流はゲーム用近似であり、HDS-5の実験係数や背水曲線・跳水の解析を代替したと主張しない。形状・水位・粗度が流量へ実際に反映される範囲での改善である。

参照: [FHWA, Chapter 3: inlet/outlet control](https://www.fhwa.dot.gov/publications/research/infrastructure/hydraulics/06138/chapt3.cfm)。入口支配と出口支配、入口・摩擦・出口損失を区別する根拠として参照した。ここで追加した部分流の補間則は本ゲーム独自の近似であり、同資料の認証済み公式とは扱わない。

雨水モデルへ接続し、最大1秒で内部積分する。1回の移送は流入口より上にある水と2セル間の均衡水量を超えないよう制限し、全流出を合わせて水の非負・収支を保つ。画面の技術詳細に保存径・長さ・各流況と流量を出す。水面が上がれば排水能力は変わり、逆流も起きる。運動量・洗掘・管内貯留・実測校正・自動設計径はなお未対応。

この追加後は390試験0失敗。既定村600秒・50mm/時・5m格子で、3管接続、総通過1.4905983m³、最終水量7114.1851750m³、収支誤差最大1.11e-10m³。実ブラウザも同じ世界IDで600秒まで完了し、最終量のNodeとの差は約2.13e-8m³だった。技術詳細は browser-circular-culverts.json。全4世界の統合・160旋回・旧40世界も再検証した。

## LOD差分均衡と海面下の閉鎖流域（生成版9）

均衡済みの6面木を1か所分割したとき、新しい子タイルと、そのために分割した隣接タイルだけを順に調べる方式へ変更した。各試行で全葉を繰り返し走査する必要をなくし、最後に独立した全体検査も行う。読み込みは実際にキャッシュされた親を先に要求し、粗い階層と画面外の隣接部分を揃えてから細部へ進む。未表示の細部だけを先読みして親待ちになる処理を抑えた。

120秒CPU表示で、局所均衡版は主処理p50=4.3ms / p95=31ms / 最大197.7ms、親優先版は4.6ms / 40ms / 199.4ms。双方で隣接違反0・全消失0・最終エラー0、実描画約5.3fps。親優先版の最大計画処理片76.9msなので5msの厳密上限はなお未達。固定した橋の近接では操作後56秒の確認時点でL18へ到達していたが、最初に到達した時刻を連続測定したわけではない。CPU診断画像で橋下の同じ川・道路・家屋を確認した。GPU30fpsや速度改善の保証とはしない。

海面より低い閉鎖流域で、低水位の湖から露出した底を全球海面のfallbackが再冠水させる不具合を検出。新生成には明示した湖水位の乾いた領域も優先する契約を追加した。旧保存の解釈は保持する。planet-1の低水位条件を5番目の世界として追加し、海面下の露出底300地点以上で海への誤分類がないことを確認した。5世界190,505組の湖岸で未定義0・1cm超段差0、396試験0失敗。

河川の残る4不適合区間について、球面の探索範囲を端点の前後にも拡張する試作を行ったが、解消せず計算だけ増えたため採用していない。結果は元の上限/失敗診断を保持する。

## 世代を固定した公開と画面間移動

世界の再生成中に既存の閲覧ページが別世代の地形ページを取り込まないよう、保存・数値ページ・地物・manifestを内容ハッシュの世代ディレクトリへまとめてから、入口manifestを原子的に切り替える。旧世代を上書き/自動削除しない。既存世代と異なるバイトを同じ名前へ書こうとした場合は拒否する。世代を作るたびにディスク使用量は増えるため、不要な旧世界の削除は別の明示操作とする。

雨水/車両画面へのリンクと全球へ戻るリンクも同じ世代のmanifestを持つ。描画方式だけをCPUへ変えるリンクでも世界指定を落とさない。実ブラウザで全球→雨水→全球を往復し、同じ世代の世界ID/保存を保持することを確認した。旧入口の world.snapshot.json は互換用に原子的に置き換えるが、新しい画面間移動は不変の世代別保存を参照する。

D4の隣接方向だけを使う別の河川試作では4世界の却下を0にできたが、湖領域との整合が崩れた。5世界で113/164/264/215/88組の1cm超段差を検出したため未採用。失敗した試作は現行地形へ混ぜていない。

## 5世界の選択と共有合流点（生成版10）

標準・別地形2種・低水位の終端湖・海面下の閉鎖流域の5保存を `npm run planet:examples` で順次生成する。全球画面の「世界の例」から切り替えられ、同じ世界の集落・橋・湖・車両・雨水へ進める。生成CLIは `--lake-fill=0..1` を明示入力として受け付ける。これは降水/蒸発による湖水収支の自動決定ではない。

低水位の露出底を流れる河川について、選択済みDAGを上流順にたどり、共有する下流節点を掘削上限内でだけ下げる。湖・海・放流口の固定水位は変更しない。5節点の修正により海面下の閉鎖流域の受理区間は74→78、却下は5→1となった。残る601→474は必要掘削が100m上限を超えるため保持する。他の4世界の却下数は1/1/2/0で、水系全体の完成ではない。画面にも受理/未接続区間数を表示する。

診断の水域数に実際に水がある湖セルを含め、既知の終端湖の排水終端を「未解決の陸上終端」と誤計上しないよう補修した。終端湖の75/398セルは明示した既知終端として別集計する。河川プロファイルの却下診断は別に保持し、粗格子の排水終端が既知というだけで連続地形の接続を合格にしない。

クラウドの実ブラウザで海面下の閉鎖流域→低水位の終端湖を切り替え、選択ラベルと別世界ID、8集落・11湖・196河川・未接続0という生成診断が一致した。全体の検証は引き続き有限標本の範囲であり、GPUや人間による自然さの受入ではない。

生成版10の全402試験・build・5世界統合が成功。家屋数151/98/104/108/139、道路標本計53,055点。旧40世界8,819地点は同じNodeで上流コードと一致し、保存された旧Node数値との差最大4.44e-10mは従来どおり明記する。湖岸190,505組の検証は同じ河川補修後に1cm超段差0を確認済み。

## LOD試行の差分記録

細分化を試すたびに最大512項目の木全体を複製していた処理を、変更した枝・隣接枝だけの取り消し記録へ変更した。最後の全体隣接監査も分割可能な反復にした。斜面3条件×高度3条件の9計画は、変更前と木の全内容・順序・診断が一致した。予算却下時にも枝が欠けず、同期/分割実行が一致する回帰試験を追加。403試験0失敗、build成功。

120秒CPU診断表示では隣接違反0・全消失0・エラー0、最大計画処理片28.2ms（以前の親優先計測76.9ms）だった。ただし主処理p50=7.3ms / p95=158.5ms / 最大417.1ms、実描画5.01fpsで、画面全体の応答性改善は確認できていない。計画片も厳密5msには届かない。計測中にNodeの全試験も実行しており、独立した性能比較ではない。改善した指標だけで性能ゲートを通過扱いにしない。記録は browser-cpu-journal-plan.json。

## CPU診断描画のバッファ再利用

毎描画で作っていた画像/深度バッファを画面サイズが変わるまで再利用し、三角形の色変換を画素ごとの反復から外した。近面で切断されない三角形は不要な切断用配列を作らない。変更前の9条件（近面3×モーフ3）の画像バイトと三角形数は完全一致。405試験0失敗、build成功。

120秒の実画面は隣接違反0・全消失0・エラー0、実描画5.07fps。主処理p50=7.1ms / p95=144.6ms / 最大469.3ms、最大計画片30.6ms。CPU表示が十分軽くなったとは言えず、30fps/GPU受入を完了扱いにしない。記録は browser-cpu-reused-raster.json。

## 明示流量・水位条件からの管径選定

`sizeCircularCulvert` は最大64径候補×64設計ケースを評価し、すべての明示流量×安全係数を満たす最小径を選ぶ。該当候補がなければ未達とし、生成側はエラーにする。`generatePlanet({culvertDesign})` → 保存routing@3 → 再構築 → 雨水計算 → 画面の技術詳細まで接続した。旧routing@1/@2と既定0.4m径は変更しない。入力流量を、降雨から推定済みの値として捏造しない。

実入力は0.06m³/s、安全係数1.2、入口上0.6m・出口上0.1m、候補0.2/0.3/0.4/0.6/0.8/1m。1集落の3管がいずれも0.3mとなった。保存の径や選定結果が入力と一致しなければ再読込を拒否する。最初のNode試験後、実ブラウザだけが容量0.42890161788733466対0.4289016178873346の差で読込を拒否する問題を検出した。再計算した容量証拠にのみ32 ULP相当の丸め許容を付け、径・設計条件・採否は厳密一致、保存hashも厳密のままとした。1e-6の改変は拒否する回帰試験を追加した。

409試験0失敗・build成功。Nodeの600秒/50mm毎時で最終7114.225990249839m³、収支誤差最大1.14e-10m³。ブラウザでも同じ保存IDと3本0.3m径で600秒を完了し、最終7114.22599022853m³（差約2.13e-8m³）。実入力/実出力は culvert-design.json と browser-culvert-design.json、保存例は examples/planet/culvert-design。世界の設計流量を得る流域水文、背水解析、校正、洗掘は未完で、暗渠設計全体の完了とはしない。

途中でクラウド環境の再起動により全試験プロセスが失われた。未完了の試験を成功とはせず、環境復帰後に全件を再実行した。

## 生成版11: 地表の細部と生成予算

新世界の地表に1800m/1.5m、120m/0.25m、8m/0.04mの3つの波長/振幅帯を保存した。最後の帯は1m刻みの実地盤参照にも現れ、表示専用の凹凸ではない。元の粗格子中心・海岸/湖岸制約と、同じ座標の保存再開/ページ参照を保持する。生成版を11へ更新し、既存の版10以下の保存は変更していない。これは地質や浸食の再現ではなく、上限が明示されたゲーム地表の詳細化である。

411試験・build・5世界の統合・湖岸190,505組（未定義0、1cm超段差0）・旧40世界8,819地点が成功。家屋数156/94/107/105/139、既定世界160旋回で支持条件外40・衝突候補70。地表を細分化すると通行判定も変わるため、以前の36/68を現行結果として流用しない。既定雨水600秒の最終7143.9620022m³、収支誤差最大1.03e-10m³。全5表示例と明示設計径の例を新しい不変世代へ再生成した。

同時に、512×256の粗格子を試したがplanet-1/planet-aの河川不適合は4/7と解消せず、同一256MiBプロセスの3世界目でheap不足終了となった。大格子化を解決策として採用せず、この条件の再試行はしない。既定の生成上限を粗格子32,768セル・河川32,768点へ制限し、大きすぎる要求は配列を作る前に拒否する。明示的な予算引数で増やす場合もメモリ保証とはしない。画面の拡大は粗格子を増やさずに行える。実験記録は generation-budget-probe.json。

## 車両の準静的な滑り・転倒条件

4輪から得た同じ支持平面に、明示した速度・摩擦係数・重心高を接続した。重力と指定水平加速度の合力を地面の法線/接線に分解し、必要摩擦と、荷重の作用線が4輪の支持範囲内へ落ちるかを調べる。一定操舵の経路には各区間の曲率を保存し、後軸より前にある車体中心の前後/横加速度を使用する。直線区間へ移った後まで旋回加速度を掛け続けない。

画面に速度・仮定する摩擦・重心高を追加し、条件外を紫色で表示。摩擦を地面から推定済みとせず、サスペンション・操舵の過渡応答・標本間の接地は未判定と明示する。接地の失敗を安定性の合格で上書きしない。

416試験0失敗、build成功。既定8村160旋回で、10km/時の準静的条件外14旋回、30km/時160旋回。実ブラウザでも同じ村/位置/世界IDで、10km/時は接地条件外0・安定性条件外0、30km/時は接地条件外0・安定性条件外33確認点となった。直線の終端では曲率と横加速度が0。証拠は vehicle-sweeps.json と browser-vehicle-stability.json。これらは指定したゲーム車両の入力モデルの結果で、実際の車の安全速度や事故予測ではない。

## 2026-10-10: Absolute incision blending and explicit valley generation

Generator @12 replaces the relative p16 incision union with an absolute-width
C1 smooth maximum. In a 355.72 m-deep trial valley, overlapping capsules had
increased nominal 3.117 m water depth to 18.86 m. The new union adds at most
5 mm per combination and keeps this station at 3.117 m. Saved pnorm16@1 and
untagged river networks retain their original sampler arithmetic; 7,104 probes
on the five saved @11 networks match the prior implementation exactly.

An explicit `riverValleys: {maxIncisionM:600,sideRunPerRise:3}` option broadens
banks according to the required incision. This is a different terrain-generation
policy, not proof that the previous strict 100 m channel-only constraint was
met. Default channel-only generation still reports 1/1/2/0/1 rejected links.
The optional valley mode connects all selected drainage links in the five
reference worlds, preserves 190,505 shoreline boundary pairs without >1 cm
jumps, and matches paged versus resident river/road/building samples. Its 23,819
stored river stations have no uphill realized water level and no water level
above their fitted profile. This does not establish continuous drainage between
all points or represent physical erosion/calibrated valley morphology.

`npm run verify:planet-valleys` repeats the station, shoreline and integration
checks with the explicit policy. The independent generated experiment is at
`examples/planet/valley-experiment`, not substituted for a completed standard
world. The broad valley experiment exposed a rendering-budget issue: refining
dry kilometre-wide banks as densely as water exhausted the mesh budget. Wet
channels now take priority, with width-dependent 0.5–16 m subdivision, separate
32 m broad-bank refinement, and no internal display skirts rising through wet
channels. The actual CPU-only browser improves the foreground channel, while
distant/coarser tiles and cache/LOD constraints remain visible limitations.

The full suite and build pass (424 PASS / 0 fail), including the low-LOD
valley/water mesh regression. The 16 additional `valley-audit-0..15` seeds also
have no rejected selected links (graph-fit check only). `node
scripts/generate-valley-example.mjs` reproduces the broad-valley inspection
world. Subdivision is fairly budgeted across original water-intersecting
triangles rather than allowing the first triangles to consume the whole tile.
Wet riverbed morph targets and internal/exterior skirts no longer create
artificial dams across the canonical water surface. Strict original Node 22
witness replay still fails under this Node 24 runtime on the already-observed
~1e-14 gradient rounding; comparison to untouched upstream on the same Node
runtime remains exact across 40 worlds / 8,819 samples. Neither old witnesses
nor tolerances were rewritten to hide that distinction.

## 2026-10-10: @13 standard valley generation and mesh-byte-aware planning

The inspected valley policy is now the default for new worlds, exported as
`GENERATED_RIVER_VALLEYS` (600 m maximum incision; 3:1 bank run/rise).
`riverValleys:null` / CLI `--channel-only` retains the strict 100 m channel-only
mode, including the original rejected-fit regression cases. This is a versioned
world change; old snapshots and immutable generations are unchanged.
The five newly published examples have 39/45/238/196/79 accepted river profiles
and zero rejected selected links. They retain 156/94/107/105/139 houses. Their
69,666 intermediate river probes and 53,055 road probes match paged/resident
queries; shoreline boundary checks remain 190,505 pairs without >1 cm jumps.
The standard world is `sha256:ab57ba996ec1aee89a396694f9eba97cdf4f1185a9025dcd039318613ea6930b`.

The new default also passed the 600-second saved-world rainfall comparison,
160 vehicle turns and explicit culvert sizing. The full suite is 428 PASS /
0 fail, and build verification passes. Quasi-static limits remain visible:
14 low-speed and 160 high-speed unstable turns, 40 support violations, 70
possible collisions. These are detected failures of driving conditions, not
hidden successful traversals.

Tile planning now records observed mesh bytes (including rejected uploads) and
rejects unaffordable refinement groups before continuing to request them. The
fallback estimate for unseen tiles is 64 KiB and the observation map is bounded
to 2,048 entries. Balanced coarse parents are retained and the existing hard
63 MiB mesh-cache limit still applies. This is not a 63 MiB total-browser-memory
claim: browser/Worker heaps, temporary geometry, code and other tabs are separate.
Actual Chromium Task Manager measurements are being recorded because desktop
terminal processes cannot see browser processes through `/proc` in this cloud
setup. That failed OS-level attempt did not count as zero browser usage.

### @13 cloud browser follow-through

Actual 120-second CPU diagnostic tour: 5.09 rasterized fps, scheduler callbacks 31.38/s, update-interval p95 150ms, no empty geometry frames, no displayed neighbor-balance violations. The UI summary now distinguishes rasterized frames from scheduler callbacks. The 30fps GPU acceptance gate is not met or replaced by these callback counts.

Chromium Task Manager observations over 374 seconds: main tab plus two workers 177,420 → 535,624 → 548,556 → 221,524 KiB. Memory fell after movement stopped; this short observation is not a long-term leak proof. Other open task tabs/processes are included separately in browser-memory-observations.json. Shell /proc cannot see the browser namespace, so its zero-process result was explicitly rejected as a memory measurement.

### Pier face coupling and diagnostic rendering (2026-10-10 JST)

Saved bridge supports can now obstruct finite-volume cell faces at their actual
intersection width and height, even when the cell centre misses the pier.
Overlapping boxes are unioned, not double-counted; water above a support top
retains an open head range. This is an opt-in scenario field, enabled in the rain
viewer, with a visible switch and orange face markers. Legacy centre-sampled
scenarios remain reproducible. All three bridge villages were run for 600s at
50mm/hour with and without the face obstruction, from identical initial storage.
The 11/16/12 supports couple 10/16/12 respectively; one support entirely within a
cell is explicitly unresolved. Storage displacement and within-cell circulation,
pressure drag, momentum, and scour are not solved by this conductance model.
See support-runoff.json and the actual browser result support-runoff-browser.json.

CPU diagnostic shading now interpolates color and normalized normals in
perspective, including clipped triangles, instead of assigning each triangle its
first vertex color. Analytic interpolation and alternate triangulation checks
pass. The old flat raster hashes remain tested through an explicit legacy mode.
A reusable projection scratch pool replaces repeated per-vertex temporary
allocations. The smooth-shading tour measured 4.57 draw fps (update p95 216.7ms),
so this is a visual correction, not evidence of a performance pass. Displayed
neighbor topology is now reused only while visible tile coordinates stay equal;
live morph factors and replaced buffers are always read from the current frame.

### Saved bridge foundation scenarios

`inspectBridgeFoundations` now distributes the saved deck/beam self weight and
live load, plus one centred vehicle in one selected span, onto the actual saved
support footprints. Explicit ground pressure capacity, friction, pier density
and specified scour depth drive rigid full-contact pressure/sliding/exposure
checks. Missing soil input returns insufficient-ground-data; no soil type is
invented from terrain height or color. Partial contact is outside this model.

The new same-world bridge screen shows the saved support section and highlights
condition failures. In an actual browser, village 1 had 1/11 supports over the
150kPa scenario, 11/11 exposed with 1.1m specified bed lowering, and 0/11 outside
conditions at 300kPa with no bed lowering. This is not a statement that the real
generated ground has either capacity, or that a bridge is certified safe. The
three bridges and four load/ground scenarios are in bridge-foundations.json.
Automatic soil generation, settlement, buoyancy, pile/connection behavior and
hydraulic scour prediction remain unresolved.

Reference for the limited full-contact eccentric-bearing relation:
[FHWA-HRT-14-094, Chapter 4](https://www.fhwa.dot.gov/publications/research/infrastructure/bridge/14094/004.cfm).

The subsequent topology-cache CPU tour reached 5.29 draw fps, update p95 100ms,
724 topology rebuilds / 4113 reuses, and zero displayed neighbor violations.
A further camera-frustum early rejection preserves 1,016,064 exact raster pixels
across 48 clipping/morph cases; its browser timing is checked separately.

### Cross-chart water identity and runtime bounds

Three generated worlds now have explicit lake/sea probes across two adjacent
empty metric charts (including overlap and outer boundaries), whole-world JSON
restore, and reverse-order page loading. 234 locations preserve the same water
level, depth, ground and water-body IDs. These are water-adapter probes, not
claims that settlements were generated underwater.

The test exposed a real river-mouth mismatch: Core kept the river ID at an equal
river/sea level, while paging chose the sea ID. A shared base-water selection rule
now preserves Core's existing precedence before composing local earthwork. An
explicit generated river-mouth regression was added. The unchanged resident
calculation still matches all 40 upstream saves / 8,819 probes under the same
Node24 runtime. Five-world integration passes. Legacy arbitrary overlapping
regional lake definitions are a separate contract, not certified by these tests.

A benchmark started after all root fallbacks and first geometry reported 0 empty
frames and 0 displayed-neighbor violations over 120s, first geometry at 1.411s,
5.30 actual CPU draw fps, update p95 33.4ms. Performance gate remains unpassed.
The CPU framebuffer now suspends at zero-sized viewports and bounds both axes to
420 pixels; extreme portrait windows cannot multiply allocations without bound.


### 2026-10-10: 造成後の水域種別とCPU静止画の再利用

実際の海に明示的な盛土敷地を置く回帰試験で、水深0・水域IDなしなのに resident Core だけ海と表示する不整合を再現した。選択された水層の種別を返すよう修正した。ローカルの明示水域に種別がない場合は `local-water` とし、元の陸地・海という分類を流用しない。この人工盛土は試験専用で、新しい集落生成の成功例とは扱わない。

CPU診断描画は同じカメラ・同じタイル実体・同じモーフ値とステッチの場合、前の描画を再利用する。カメラ・画面寸法・タイル・モーフ・ステッチの変化で再描画し、破棄時に参照を解放する。実画面で宇宙と地表の両方で「静止画再利用（CPU診断）」を確認した。地表ボタン後に高さ30m・L15へ更新されることも確認した。静止時0描画fpsは停止故障と誤表示せず、再利用として表示する。移動中のGPU性能を証明するものではない。

全452試験成功・0失敗、build成功。ゼロサイズ画面は描画を休止し、極端な縦長画面でもCPU画像の両辺を420px以下に制限する。水域境界試験は3seed×海/湖×39地点と河口の同一水位時ID、造成後の乾いた敷地を含む。


### 2026-10-10: @14 の村へ枝道・交差点を接続

既存の交差点コアを生成器へ接続した。村ごとに最大2本の地形適合枝道と、その沿道の家屋候補を追加する。水域、未知の水位、急坂、交差点進入路の不適合は却下する。2mごとの車道中央/両端で水域を確認する有限標本方式であり、全連続領域の証明ではない。詳細は VILLAGE_STREETS.md。

実結合により、回転したT字路の丸めによる接続消失、同位置の微小重複station、遠方の橋面を変形する交差点進入路の3不具合を検出・修正した。既存の検査を弱めず、橋を保持できない枝道を拒否する。

5世界の道路数は24/20/21/23/24、交差点数15/11/11/15/14、家屋数259/166/193/196/245。全461試験0失敗とbuild成功。道路幅方向の照合、家屋基礎、橋下水面を5世界で再検証し、旧40保存8819比較も同一Nodeの元コードと完全一致した。旧immutable世界は保持し、新しい世代への入口だけ切り替えた。

実ブラウザでも標準世界の道路分岐・家屋・河川と橋を確認した（CPU診断、高さ350m）。視覚上の自然さを利用者承認済みとはしていない。橋のない集落から橋の実験へ移動したとき、別の村の橋を勝手に表示する動作も修正し、実画面で未選択表示と明示選択後の計算を確認した。


### 2026-10-10: 読み込み・静止時の重複計算削減と長時間測定

海・河川判定に既に使った基盤標高を、地域チャート外で再利用する。新世界の4000地点で修正前後の全出力が完全一致し、評価呼び出し10114→6814。直列の一回計測では16.51秒→15.21秒であり、普遍的な高速化率とはしない。

カメラの同じ地点で地表標高を毎フレーム再計算しない。また、静止してモーフが完了した表示集合は、カメラ・LOD要求・キャッシュ世代・モーフに変化がない場合に再利用する。アップロード、破棄、要求変更、視点変更時に再計算し、破棄時に保持参照を解放する。見た目の同じ画像を残すだけで内部の重い処理を継続していた問題も対象にした。

実タスクマネージャーのCPU表示は69.0%の時点と15.5%の時点を記録した。ただし別時点の瞬間値であり、後者のメモリは再読み込み直後に増えている。メモリ改善や長時間無漏出の証明にはしない。468試験0失敗・build成功。

長時間ベンチマークは同じ60秒ツアーを繰り返す。タイミング値は上限30000の等間隔標本に間引き、全期間のフレーム数・遅いフレーム数・最大時間を別集計する。最初の30000フレームだけを長時間全体の統計と扱う問題を防いだ。視点復元で古い照合要求が置き換わる場合は正常な中断とし、赤いエラーを表示しない。古い要求の結果が新しい照合結果を上書きすることも防止する。


## 2026-10-10: 橋脚が占める水中体積

雨水画面に「橋脚の体積を水の入れ物から除く」を追加した。既存のセル境界の
遮りとは別に、回転した保存済み橋脚とセルの交差多角形を切り取り、面積×水中高さを
貯水容量から除く。セル内に収まって境界を横切らない柱も体積には反映される。
体積から水位を区分線形で逆算し、同じ水位から開始する際の初期水量も減らす。
管の入口底より上の排水可能量、2セルの平衡水位、安定時間刻みもこの容量を使う。

この実験状態は `planet-reservoir-runoff@2`。旧@1の実行結果は変更せず、
旧形式に体積排除を黙って混入できない。惑星の保存worldIdを変更する操作ではない。
全体を塞ぐ/ほぼ塞ぐ柱、重なった立体は明示エラー。セル床は標本高さで平坦、
雨は柱の上を含む水平面積から同じ貯水セルへ入る。セル内の流れ・運動量・侵食・
渦・橋面上下の多層流れは別の未実装事項で、この改善に含めない。

`npm run verify:storage` の実入力・実出力は
`examples/planet/verification/support-storage.json`。実3村で同じ水位の初期水量から
約14.36/25.80/17.25m³が除かれた。50mm/時の雨を600秒流し、両モードの
最大水収支誤差は3.5e-10m³未満。最初の村は30セル・11橋脚を体積へ接続した。
地形の全体精度や水理校正を表す数値ではない。


## 2026-10-10: 車体の時間変化を実地盤へ接続

`simulateVehicleDynamics` は、4輪の下の実地面/橋面を固定時間刻みで参照し、
質量のない車輪の片効きばね・ダンパーから車体の上下・小角度pitch/rollを積分する。
後軸の弧長と速度から時間を作り、車体中心の旋回加速度を外力として与える。
車両画面から計算・中断・再実行でき、角度のグラフと時点スライダーで地図上の位置を確認する。
背景の道路は主道路だけでなく同じ保存の枝道も描く。経路周囲へ地図を拡大する。

質量・ばね・減衰・重心を変更可能。慣性、ばねストローク、小角度の上限は明示した
比較用仮定。ばねストロークや腹下接触の違反を隠さず、小角度の適用域を越えれば
そこで終了する。進路は指定されたままで、タイヤの滑り・車輪質量・バンプストップ・
衝突応答・牽引車・転倒後の運動は含まない。ばねの線形領域外の記録は合格ではない。
途中の全地形に対する接触保証でもない。既存の建物包絡・静的接地・摩擦判定と区別する。

実3村で同じ26°左旋回と50m直進を5km/hと20km/hで比較した。
5km/hでは3村とも今回の動的条件内。20km/hでは全3村で一部の輪の計算接地力が0になり、
最初の村で最小腹下離隔が約-0.0028mとなった。これはモデル内の診断で、実車の安全評価ではない。
実入力・全時系列: examples/planet/verification/vehicle-dynamics.json。
実ブラウザ10km/hの中断→再実行→21.78秒完走→末端時点の確認は同 browser-vehicle-dynamics.json。

繰り返し問い合わせる接地には、同じ正本の `sampleSurfaceAt` を使用。標高・水・道路・
地物は `sampleAt` と同じ処理で、不要な有限差分の勾配だけを計算しない。
勾配を0で捏造せずフィールドを省く。6実時系列はこの変更前後で入力・出力とも完全一致。
