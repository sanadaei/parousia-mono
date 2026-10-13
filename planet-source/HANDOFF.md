> 2026-10-13: 対象環境は **PC**。以降の操作・画面・性能の受け入れもPC前提で進める。最新の段階・残件は[作業用ベースライン](docs/WORKING_BASELINE_ROADMAP.md)を参照。

> 2026-10-11 03:14 UTC: 860 tests PASS / 0 fail、build成功（128.3秒、256 MiB）。「集落の配置理由」がオンデマンド集落・町の任意区画にも接続。広場・礼拝所・池・菜園・施設の理由を同じ配置データから確認できます。全景観は未完成です。

> 2026-10-11 03:03 UTC: 857 tests PASS / 0 fail、build成功（129.2秒、256 MiB）。村の同じ配置の重複生成を抑制。既存8MiB枠内で再利用し、実村2件の再取得は約1ms、内容一致。初回生成・全景観・GPU実機の受入は未完です。

> 2026-10-11 02:55 UTC: 853 tests PASS / 0 fail、build成功（121.9秒、256 MiB）。表示で計測済みの傾斜を土地被覆にも接続。実タイルで地形照会回数・位置を増やさず急斜面の農地色を修正。全景観の完成ではありません。

> 2026-10-11 02:48 UTC: 852 tests PASS / 0 fail、build成功（123.1秒、256 MiB）。近景の地面も村の実際の敷地を参照するよう修正。林・畑と地面の分類の不一致を改善。町・都市の敷地境界、景観と性能の受入は未完成です。

> 2026-10-11 02:42 UTC: 851 tests PASS / 0 fail、build成功（125.4秒、256 MiB）。実測に基づく丘・山への移動を追加。保存済み地形は変更せず、局所高低差と測定範囲を表示します。丸みの強い山地・冷間読み込み・全景観の自然さは未完成です。

> 2026-10-11 02:31 UTC: 848 tests PASS / 0 fail、build成功（121.1秒、256 MiB）。実際の窪みを調べた池と湿草地を追加。実生成19池の有限検査・クラウド実画面を確認。雨季の水位を仮定した部分実装で、景観全体・年間水収支・性能の受入は未完成です。




## 2026-10-10 20:23 UTC — 近景の受入を再開、全体は未完成

ユーザーの実画面指摘により、戸数・道路の接続だけでは完成と判断できないことが確定した。目標は「中世相当の世界を Google Earth のように全球から生活圏まで連続して見られること」。PR #6 は統合済みだが、この目標の完了を意味しない。

現在の修正は `feature/local-landscape` / Draft PR #7。詳細な残件と根拠は [LOCAL_LANDSCAPE_PLAN.md](LOCAL_LANDSCAPE_PLAN.md)。

- generator 17 の丘・山は、無関係な湖の水位まで全域に作用する不具合でほぼ消えていた。generator 18 で局所化し、実生成値で改善を確認した。旧「実装済み」は実現した起伏の検証として不十分だった。
- 都市は町全体の共通街路・不規則な区画へ変更。村は広場・教会用地を先に確保する。新しい配置は版付きの方針で選択し、旧保存世界を自動置換しない。
- 樹林・細長い畑・裏庭を実画面へ接続。森林・畑の道路回避は同じ正本の道路配置を参照する。樹木の物理的な衝突・林業はまだ未実装。
- 実都市 3843:0 の全 105 区画・10,000 戸で有限の歩行アクセス確認。街路は一つにつながる。これは全世界・全条件・自然な見た目の受入ではない。
- この時点の全試験 716 PASS / 0 fail、build 成功。先行の失敗を直して再実行した結果。
- 未完了：都市と周辺の土地利用の移行、施設の庭や作業場、水辺・小さな池・支流、粗い LOD との見え方、読み込み性能、新しい地形・街路での全地域道路確認と複数地点の実画面受入。

**ここで停止・完成宣言をしない。下の古い記録は当時の到達点であり、この残件を取り消さない。**

## 2026-10-10 12:39 UTC — 建物外形の向きまで接続
任意角度の長方形を保存済み基礎の内側へ収め、回転後の面積で用途適性を判定。表示と車両障害物が同じ向き・寸法を参照する。実例29棟を道路側に方向付け、通路未確認の旧3棟は保持・警告。元世界の基礎・道路は不変で、明示生成した新しい保存版だけに適用する。
全623テスト PASS / 0 fail、build成功。再生成の出力完全一致と、保存復元を確認。PR #1（work/settlement-sunlight）へ差分のみ反映する。

## 2026-10-10 12:33 UTC — 固定配置・日照の追加
- 48施設の機能カタログ、条件付き敷地選定、保存道路グラフによる供給距離、住宅容量の確保、明示した土地用途の地形照合を追加。
- 全球共通の光方向・地方時を設定でき、再読込でも時刻を保持。配置生成をカメラ/LOD/実時刻から切り離す。
- 既存世界は未変更。明示CLIで新しい保存版を生成する。32棟＋2土地区画の実例は11用途成立/5用途見送り、23棟を住居として確保。
- クラウドCPU画面で日中/夜間、再読込の時刻保持、34区画の表示位置の完全一致を確認。
- 全622テスト PASS / 0 fail、build成功。実行ログは examples/settlement-planning/verification/。
- 任意角度の建物外形回転、地域の生態/土壌の自動推定、洪水再現期間、生産量/労働量は未実装。太陽の公転計算や美術的仕上げは対象外。
- 設計と手順は SETTLEMENT_PLANNING.md。原料・土地適性・制度に関する実例の仮定は入力プロファイルに明記。

# 引き継ぎ記録（2026-10-10 JST）

## 08:04 UTC: bounded tile metadata reuse

- 605 tests PASS / 0 fail and build succeeded. First full run timed out under concurrent diagnostic load; a retry and the direct offline runner both passed. npm's version-notice network request was blocked; no package installation was needed.
- Reuse exact tile bounds, intersecting feature references and static water upper bounds, FIFO-capped at 4096 entries per immutable manifest. Camera-dependent height ranges and resident mesh evidence remain live. Four-altitude repeated planner comparison produced identical selected tiles and quality records.
- Full-resolution numeric 30m/128MiB run converged in 339.797s, 2458 generated / 1110 displayed tiles, 64,045,273 mesh bytes, maximum ground error 1.996879px. Cache: 2458 entries, estimated 2,516,992 bytes. See viewport-lod-30m-128mib-tile-memo.json.
- Prior 425.432s run had CPU profiling enabled and 441.802s run had concurrent browser work, so these are not controlled speedup percentages. Earlier pre-water-change run was 330.957s. Near-ground readiness still takes minutes; not practical-performance completion or GPU FPS evidence.
- Eight actual scene screenshots were delivered as a self-contained HTML report (reports/planet-progress-2026-10-10.html). Snapshot is explicitly 57603bc; the report does not silently claim these later performance changes.


## 最新位置（07:29 UTC、ZIP引き渡し後の継続）

- 斜め70度・湖1の近景で、画面の大部分から水面が消える実不具合を確認。地盤だけの高さ区間で視錐台判定していたため、水底が画面外になると水面まで除外していた。描画の可視性に静的水面の上限を加え、地盤精度の判定とは分離した。湖は両方の旧/現行所属方式を包含する緯度範囲、河川は保存プロファイルの上限と記述子の範囲、海は明示海面を使う。緯度だけの湖範囲は意図的に過包含で、今後の高速化余地がある。地物の橋面は元地盤+地物許容区間も可視性へ含める。水際/水面の2px精度を証明する変更ではない。
- 同時に「地表へ」が選択地点ではなく既定の村へ戻る動作を修正。湖1を選び地表へ移動した実画面で74.531250,-18.281250/高度30mを維持。中心点照合と追従で共通の地盤/水面/橋面の最高支持面を使い、湖底へカメラ参照が瞬間移動しない。`browser-lake-oblique-water-fix.png`は水面表示を回復した実画面。ただし取得時は読み込み中で、収束/性能の合格証拠ではない。全601試験・build成功。湖の低空斜視では水底の精度が予算を消費し、地盤2px収束は未達。水面可視性を直したことと、近景水域の性能達成は区別する。

- 正本座標の法線計算をWorker内で4096件まで再利用する小さいキャッシュを追加。座標を丸めず、地物の追加/退去または微分刻みの変更で消去する。メモリ記録に推定量を加算。LRUの容量内予約も全件走査を避けた。実14メッシュの全配列/証人/上限/モーフは変更前と完全一致。186ヒット/3860ミス、2722件/推定871,040bytes。単発1469→1303msは限定測定であり、実画面FPSとは言わない。全597試験・build成功。配布した06:51更新ZIPにはこの後の変更は含まれない。

- 06:48の120.011秒巡回（投影区間版・道路検索index追加前の固定ブラウザコード）は消失/隣接違反/読込エラー0、128証人のCore差3.817e-10m以下、水深差0。CPU実描画13.524fps、30fpsゲート未達。試験前半はNode集約試験も併走した負荷条件であり、旧結果との速度比較には使わない。`browser-hull-120s.json` / audit。
- 巡回後06:50のTask Managerはタブ+2Worker390,652KiB、GPU23,048KiB、Browser72,220KiB。`browser-hull-memory-after-tour.jpg`。単一時点の観測で、長時間ピーク/リークなしの保証ではない。

- 通常解像度相当1280×720・30m・128MiBの同じ実メッシュ試験は、投影区間修正後330.957秒/2458生成/1109表示/64,045,273bytes/1.996879pxで終了した。修正前は594.499秒/3538生成/1899表示/87,996,961bytes。数値試験の作業量は減ったが、5.5分はまだ実用上長く、GPUの実fpsや待ち時間ではない。
- 同じブラウザを閉じずに村1→村2→村3と移動。350m・CPU診断で3村とも2px以内（1.7854/1.9500/1.9891）、待機0/隣接違反0。各128証人のCore照合成功。後の村で約63MiBになるのは過去のタイルを含む固定キャッシュであり、表示中タイルのみの量ではない。個別inspection JSON/auditを保存。その後120秒の連続移動も完走。
- 最新プロファイルでも道路最近傍検索が計算時間を使っていたため、区間の包囲矩形階層を追加。橋端での同距離優先規則は元の配列順を明示的に保存。折返し/交差/同距離を含む1386点は総当たりと一致、実9メッシュの全配列・証人・区間・モーフが完全一致。単発2408→2303msであり、全体の大幅高速化とは主張しない。全595試験・build成功。

- 06:37 UTC、第一村350m・CPU診断265px・64MiBの実画面が295表示タイル/計画294葉、約30.9MiB、最大1.785408px、生成待ち0へ到達。以前の799枚/約61MiB/4.54pxとは、同じ世界・視点・予算。不要な細分化の原因は、タイルを囲む円盤が実タイル外の橋端を含んでいたこと。球面の実四隅から正距方位投影の区間を作り、必ず近い隣接道路区間がある端点候補を除外した。地形サンプル/保存IDは不変。
- `browser-village-hull-64mib.json` は静止点の inspection-only。128証人のCore差は地盤7.242e-11m、水深4.173e-11m以下。巡回/FPS合格に読み替えない。`audit-browser-tour.mjs` に静止記録の明示分岐を追加し、既存の完走条件は維持した。静止記録をcompletedに付け替えた入力は拒否、旧完走記録は継続合格。
- 球面投影区間は基底の線形内積と atan2(s,u)/s の単調性で導出。未知の曲率上限を仮定しない。12種類の球面セルの3,840軸比較を包絡、実48タイル2,352点のCore差0。auditの静止分岐と入力検査の小変更を含む最終コードで全594試験/build成功。
- 「約10分」は通常解像度相当の実メッシュを、Node内の非同期2枠で計算した数値試験。独立CPUスレッド2本や実GPUの待ち時間ではない。最新の同条件再実行を開始した。

- この橋端の初期対応は全592試験 PASS / 0 fail、build成功。実6タイル384点の正本→実描画辺の距離は各上限内。ただし村全体は旧途中版の実測で3.51px、予算不足と境界近傍の過大区間が残る。全体合格ではない。
- 橋端の描画を片側ずつ切り分け、その間にほぼ垂直な地盤面を追加。既存の橋脚箱を重複生成せず、世界の地盤評価/保存IDも変更しない。直線道路のみ対象、湾曲/折返しは従来の保守的処理へ戻す。片側サンプルの隙間は実6タイルで最大約0.0134mm。縮退三角形の法線NaNが試作で出たため、ゼロ面積の壁を除外して実タイル回帰試験にした。
- 元の半径方向の高さ誤差は残し、実際に描いた壁の辺までの「正本地盤→描画面」の距離上限と、垂直段差を含む閉じた地盤表面への逆方向距離上限を別に計算。球面セルと高さ区間からの幾何上限であり、段差高を単に引いた値ではない。半径方向補間の精度にすり替えない。法線・水際・遮蔽は認証しない。`bridge-breakline-mesh.json` と `scripts/verify-bridge-breaklines.mjs`。村全体の受入はまだ。
- 通常解像度30mの軽量化後の再測定は594.499秒、1899表示葉、1.997856px、87,996,961bytes。旧600.209秒と実用上ほぼ同じ。単発・併走負荷を含むため高速化成功とはしない。`viewport-lod-30m-128mib.json`。この実行は橋端の修正前。

- 1インスタンスで継続。ユーザー確認待ちはない。05:50 UTC、ユーザーがGitHub反映を自分で行うと指示したため、転送を停止。ブランチは作成・更新していない。a51ab28のコード/生成物/検証記録一式を3つの通常ZIPとして05:53 UTCに引き渡した。以後の変更はこのZIPに含まれない。
- 06:09 UTC、350mの村全体表示で別の精度未達を確認。L28でも3.276mのセル高さ幅が残り、地盤+ステッチ上限4.54px。実点(30.927910604540664,-132.15017082145297)を調べると、橋のたもとで盛土から橋下の元地盤へ切り替わる約3.276mの段差だった。幅0.12mの289点でfill側605.8989m / bridge-deck下602.6225mを確認。以前の道路同士の法面8.65cm段差とは別問題。bridge-abutment-discontinuity.json。
- この橋端の垂直面を連続な高さ場と同じ基準で細分しても高さ差は消えない。世界を勝手に平滑化して水路を埋めるのではなく、橋台の垂直境界を表示形状と誤差評価に明示する必要がある。通常解像度の30m第一地点の合格を、村全体の合格に広げない。現段階で修正完了とはしていない。

- 06:04 UTC、1280×720・30m・128MiB設定の実メッシュ/計画器が600.209秒で収束。1899表示葉、3538生成、地盤上限1.997856px、未知上限/隣接違反/読込エラー0、87,996,961bytes。GPU描画は行わない独立計算であり、10分という待ち時間は実用上未達。viewport-lod-30m-128mib-progressive-baseline.json。
- 実6メッシュのCPUプロファイルで道路最近傍処理と不要な横断面計算が重いことを確認。線分の幾何比較後、勝った線分だけで縦断曲線/横断面を評価する。実9メッシュの全配列/法線/証人/区間上限は完全一致。単発Node3201→2239ms。road-nearest-winner.json。全587試験・build成功。
- 画面に「地面の準備中／細かく読み込み中／目標到達／表示予算で未到達」を追加。計画上の未来の精度ではなく実際の表示地盤を判定し、CPUの低解像度も明記。実画面で読み込み表示を確認した。
- 06:00のブラウザTask Managerはタブ+2Workerが593,412KiB、GPU23,784KiB、Browser70,012KiB。その他サービスも保存画像参照。固定形状63MiBとブラウザ全体を混同しない。1時点の観測であり長時間のピーク保証ではない。

- ZIP引き渡し後に最新の120秒巡回記録を回収・Core照合。120.006秒、消失/隣接不整合/読込エラー0、128証人の地盤差4.482e-10m以下、水深差0、CPU実描画12.866fps。GPU30fpsは不合格。browser-progressive-120s.json と -audit.json。
- LOD候補を毎回全件sortする処理を安定優先度キューへ変更。試行した細分が予算で戻る場合、追加候補も採用しない。5世界×3高度×2画素高の30ケースは順序付き計画・品質値が旧実装と完全一致。単発Node合計1004→797msはJITを含み実fpsの改善とは扱わない。全586試験とbuild成功。
- 通常解像度の5分試験は未収束で保存。個別検証の時間上限を引数化し、最大30分/12000生成まで同じ表示計画を追う実験を実行中。無期限の大量探索は行わない。

- 最新の30m静止・64MiB設定は477計画葉が全常駐、478表示タイル、地盤上限1.990262px。CPUの実フレームバッファ高さ265pxを使用する。以前のCSS高を使った保守的な目標から修正したため、通常解像度GPUの合格とは比較・混同しない。128証人のCore差は最大4.482e-10m、水深差0。browser-progressive-ground-64mib.json と -audit.json。
- 不明な子メッシュを一度生成し、その実上限から次の詳細化を判断する。上記と同一の収束画面で生成枚数2854→1402、使用約37.4MiB。隣接調整の粗面準備は保持。移動中の検証は続行中。
- 最大階層を24→28へ拡張。15実メッシュ960内部標本は保守上限内。全6面の座標/辺分類も試験。全585試験・build成功。固定予算は64/128MiBのみ。
- 通常解像度1280×720の実メッシュ・実計画器を独立実行する検証を追加。5分の計算予算は個別実験の上限であり、未収束ならそのまま記録する。GPU描画/FPSを代替しない。

- 新しい道路接続版は全585試験 PASS / 0 fail、build成功。車体の動的応答と勾配を不要とする表面参照も含む。
- 新規 generator@16 は複数道路の法面を squared-odds@1 で連続混合。@15の実村で、1.5μm刻みでも8.65cm残っていた段差を、同じ刻みで0.54μmの変化へ縮小。47車道標本は不変。旧レシピに新規則を補わず、保存ID/旧評価を維持。証拠 road-batter-continuity.json。
- 新規5世界の再生成・保存/再開・PagedSource統合を通過。80,840道路標本、69,666河川標本、家屋259/166/193/196/245、基礎高さ差0。実48タイル2,352点のCore差0、6メッシュ384内部点は区間上限内。
- メッシュ生成の待機を scheduler.yield / setImmediate へ変更。実12メッシュの全頂点/三角形/属性は完全一致。ブラウザWorkerでも scheduler.yield を確認。負荷併走時の瞬間fpsを性能受入値にしない。
- 要求3072/訪問9600へ拡張し、旧@15の30m静止で847計画葉が全常駐。地形63MiB+村1MiB上限を維持。ただし最大地盤上限4.915px、2px未達。browser-ground-budget.json。新@16の実表示は検証継続中。
- 新しい試験を走行中に追加したため初回全件実行はテスト内の未定義 charts 参照で573/574。そのテストを正しい公開入口へ修正し、個別4/4、再実行した全574件とbuildも成功。機能の成功扱いで失敗を隠さない。
- 旧厳密witness照合は既知のNode22/24の微小勾配差で停止。元witnessは書き換えない。同一Nodeで旧未変更版と比較した40保存8,819点の記録とは区別する。
- 5つの画面用世界もすべて@16として新しい不変フォルダへ生成。旧版は残した。道路区間の距離選別を曲線区間計算より前に移し、実774範囲の出力はビット一致、単発Node処理は合計約154ms→46ms。全574試験とbuild成功。
- ブラウザは保存URLが@15固定だったため、reloadだけでは新世界にならないことを確認。04:23 UTCに標準manifestのURLへ移動し、@16の地表読み込みを継続。旧画面を新世界の検証と混同しない。
- 新@16の30m静止は852表示タイル、読込0/2で収束。全体64MiB枠で地盤上限4.002px、2px未達。正しい@16の保存ID・128証人を browser-blended-ground-64mib.json に保存した。
- 実際の三角形の頂点高さ範囲を使い、地盤区間の過剰な誤差見積りを縮小。実12メッシュの全三角形属性は不変。6メッシュ内部384点の検証成功。これを読み込んだ新画面の測定はまだ。
- 全幅道路の判定も補強。5世界80,840標本で地盤支持された車道と実地盤の差0。新@16の600秒雨水、3村の橋脚容量比較、6走行の動的応答を再実行。水量誤差は最大3.5e-10m³未満。5km/hは3村で標本条件内、20km/hは3村とも接地力不足など条件外。
- 既定64MiBは維持し、明示128MiB設定を追加。Worker2、80%計画/20%遷移、硬いLRU上限は不変。容量不足で自動増量しない。実画面の選択操作とURL反映を確認し、同じ@16の30mで128MiB設定を読み込み中。高設定の精度/全体メモリ受入はまだ。
- 地形ページの連続参照を軽量化。LRUの最新項目への再アクセスは並び替えず、順序は10,000操作で単純参照実装と一致。さらに不変ページ/ノイズに限り補間パッチを1個再利用し、可変入力の既定挙動は維持。実12メッシュの全三角形属性/証人/上限はビット一致、単発Node合計7.10秒→3.19秒。ブラウザfpsとしては扱わない。
- 04:38のTask Manager読取りはタブ+2Worker+履歴ページ群574,940KiB、GPU24,632KiB、ブラウザ69,684KiB。他のサービスも画像に保存。これはロード途中の1標本で、ピーク/長時間メモリ受入ではない。browser-128mib-memory-warming.png。
- 04:39に表示を維持したままWorkerを再起動し、出力同一を確認した補間再利用を適用。128MiB試験は静止した精度の比較であり、この途中更新を含む値を固定版の性能試験とは扱わない。
- C1デモのCPU面境界の黒線は修正し、実L19表示で消失を確認。
- 雨水の中断/再開を実ブラウザで確認済み。集水範囲の条件付き管径評価も画面へ接続。
  実3村の標準5m/10mでは全10管が解像度一致を満たさず、候補を確定しない。詳細CATCHMENT_FLOW.md。
- CPUの固定5.56fps上限を除き、時間占有を抑える可変間隔へ変更。実120秒で13.991fps。
  追加の画素補間軽量化も同じ120秒で14.108fps。30fps/GPU受入は未達。
- 橋脚の体積を新しい雨水状態@2へ接続。実3村で600秒、実ブラウザでも@2の600秒を確認。旧@1は維持。
- 車両の4輪ばね・減衰から車体の上下/前後/左右の応答を実装。実3村の5km/hと20km/hを比較し、20km/hでは3村とも接地力0を検出。1村では腹下の接触標本も検出した。実画面の中断/再開・時点操作・入力変更時の無効化・80km/hでモデル範囲外終了を確認。
- sampleSurfaceAt は同じ正本の地面・水面を返し、不要な有限差分だけを省く。6実走行の出力は変更前と完全一致。旧40保存8,819標本も同じNode24の未変更基準版と一致。
- 地盤全体の表示誤差、粗格子内部で縮まる高さ範囲、球面河床の区間境界を追加。実32タイル/1,568点でCore一致。道路の三次縦断曲線・法面・敷地の目標高さを正本アダプタで範囲合成し、実画面へ接続した。次は詳細化のメモリ配分と追従速度を進める。車両は指定経路・小角度モデルであり、タイヤや衝突応答の完成ではない。
- 粗い親タイルの水際細分予算を削減し、近景L16以降の予算は維持。実9タイルの元格子289頂点×12成分は変更前と完全一致。最大のL14例は1,762,040→419,264bytes。120秒の負荷併走巡回は消失/隣接不整合/読込エラー0、128標本の最大地盤差2.81e-11m。描画11.75fpsは試験処理との同時負荷結果で、旧試験との速度比較には使わない。
- 道路/敷地の範囲はタイルの投影円盤に限定。無関係な地物を除き、道路継ぎ目を跨ぐ場合も全域が車道と証明できれば元の未造成標高を外す。L22/24の村中央の高さ幅は約2.4e-5mへ縮小（以前約4m）。実48タイル/2,352点はCoreと完全一致。LOD計画も未造成地形だけでなく地盤全体の誤差を参照する。
- 公式Nodeランチャーで実120.077秒の巡回が完走。描画15.107fps、消失/隣接不整合/読込エラー0、128点Core照合は地盤最大2.84e-10m。これは局所範囲改善前の固定版。最新局所範囲の実画面詳細化は検証継続中。
- L18以降は各16×16格子の円盤で地盤範囲を評価し、法面のsmoothstep自体も区間化。センチ級円盤の角度はacosからatan2へ変更しゼロ丸めを防止。実6メッシュ384内部点で証明上限を超えないことを確認。最大要求768枚/訪問2400へ拡張、63MiB地形上限は不変。
- 近景優先だけで要求すると、隣接粗面が揃わず表示がL1へ戻る実失敗を確認したため、その試作順序は撤回。粗い隣接群を先に揃え、親の兄弟群の準備も要求する。実14.4m視点はL23まで到達、99表示タイル/47.7MiB。最大地盤上限172.22画素で2画素条件はまだ未達。証拠 browser-cell-ground-bounds.json。
- 記録保存ボタンが測定前には何も保存しない問題を修正。測定前の出力をinspection-onlyと明示する。実ブラウザで保存し、128標本を持つ inspection-only JSON を確認済み。
- 入口セルだけの集水比較に、幅を明示する理想集水線を追加。地形や管を変更しない条件付き診断。3村×2幅×2解像度の実入力出力を保存。20m幅では5m/10m間で2管が一致するが、10m/20mでは一致しないため収束とは呼ばない。実画面で緑の線、中断→再実行、入力変更による古い結果の消去、範囲外入力を確認。詳細 CATCHMENT_FLOW.md / collectors.json / browser-collectors.json。
- 常時30fpsの合否はp95だけで判定しない。WebGL2・実描画30fps以上・全フレーム33.33ms以内を要求し、稀な遅延を見逃さない。CPU表示は引き続き未受入。
- 造成後地盤の保証上限がある場合、表示されない未造成地形の誤差をLOD精細化条件に重ねない。ステッチは該当辺の最大親子変位だけを使用し、CPU/GPU両経路へ保持。実14.4m視点の静止後は最大地盤上限172.187画素、2画素条件はなお未達（browser-edge-ground-bounds.json）。
- CPU描画は共有頂点の投影を一度だけ行う。実3村×傾斜3×モーフ2×境界2＝36画面の画素ハッシュが旧41d44adと完全一致。software-projection-reuse.json。単発CPU時間はJITを含みfps改善の証拠にしない。最新固定版の120秒実画面測定を続ける。
- dc4789d固定版の120.031秒巡回は16.704描画fps（CPU）、消失/隣接不整合/読込エラー0。128点のCore差は地盤4.57e-10m、水深1.34e-10m。browser-projection-reuse-120s*.json。GPU/30fpsは未達。
- ページ離脱で停止したWorker/描画器をbfcache復帰時にそのまま再利用しない復帰処理を全球・雨水・車両・橋へ追加。全球の視点と選択村を離脱前にも記録。実際のBack/Forwardで村2・350mを復元し、雨水は600秒まで再実行した。bfcache自体への採用は観測しておらず、persistedイベント分岐は単体試験。browser-navigation.json。
- 要求枠1024の試作では硬い63MiB上限付近まで計画が埋まり、古い表示と新しい兄弟を同時に置けず近景が粗くなる結果を確認。枠は768へ戻し、計画は上限の80%までとして残り20%を遷移用に確保する。生成前の子も親から継承した正本高さ範囲を使う。これは精度達成の宣言ではない。
- 地形と水/道路の重複頂点を、全Float32ビットと辺分類が同じ場合だけ共有する。三角形の順序・属性・正本照合値は不変。実3村×4LODで完全一致し、最大例1,456,795→364,529bytes。mesh-compaction.json。原格子と最初の追加面の互換参照位置も維持。最新全560試験とbuild成功。読み込み途中の14.4m画面は22.9MiB、L23、78枚。最大誤差上限はまだ197.34画素で、精度受入ではない。browser-compaction-checkpoint.json。
- 道路横断形状を全幅振幅ではなく観測領域の区間へ限定。橋端点のラベルは実際にその端点へ届く場合のみ候補に含める。実村2のL22地盤上限は2.759m→0.04134m、全384内部標本の高さ/補間誤差は変更前と完全一致。実48タイル2,352点もCore一致。road-interval-refinement.json。
- 圧縮後の要求枠1536/訪問4800は試験中。63MiBの硬い上限と80%計画上限は維持。常駐範囲拡大だけで速度/精度合格とはしない。
- 地域の1回の参照内で同じ基礎地形を再計算しない。実3村×256点で全返却項目が完全一致し、基礎参照回数は各約1,020回→256回。問合せを跨いで保持せず、例外/再試行/入力変更を検証。chart-ground-reuse.json。
- 河川の球面円盤区間も既存の空間索引を参照し、無関係な全河川の走査を省く。広い円盤は元の全走査へ戻し、合成順序は維持。実1,232範囲は全て旧範囲と完全一致。単発Node時間889.9→66.3msであり、ブラウザfpsとは別。indexed-river-bounds.json。
- ceae0f2固定版の120.0106秒巡回は完走。15.932描画fps（CPU）、消失/隣接不整合/読込エラー0、128点Core差は地盤3.82e-10m・水深0。環境接続の再起動表示があったがブラウザは継続しており、完走JSONを回収した。browser-indexed-bounds-120s*.json。30fps/GPUは未達。誤差最大の3タイルも技術表示へ追加済み。
- 近傍道路の弱い法面が強い法面の高さ範囲を広げていた。正本の「最大影響度が勝つ」と同じ条件で、上限が他の下限を下回る候補だけ除外。実最悪例のセル高さ幅2.0018m→0.1512m。地形値は変更しない。実48タイル/2,352点Core一致、6メッシュ384内部点も上限内。
- 最新5世界を再生成して保存復元/ページ/Core/家屋/道路/河川を一括照合。家屋259/166/193/196/245、道路80,840点・河川69,666点、5世界とも河川不採用0。河川/Core差0、敷地差0、道路最大差3.72e-9m。integration.jsonを現行結果へ更新。
- 以前の節にある「30分後に確認」「実行中」は履歴。30分は完走し、上記の個別実画面検証も実施済み。


## 2026-10-10: 固定版の30分試験が完走

ソース f4e56a8、@15標準世界、CPU診断表示で1800.0262秒の全景↔地表/極/日付変更線
巡回が完走。全期間visible、地形全体消失0、隣接不整合0、読込エラー0。
最終128標本を現行Coreへ照合し、最大地盤差6.1e-12m、水深差2.3e-12m。
実描画5.365fpsで30fps条件は不合格。更新回数と描画fpsを混同しない。
Windowヒープの記録上最大152,357,329bytes、管理対象の最大71,214,237bytes。
Chromium Task Managerの終盤2時点ではタブ+2Workerが520,076/473,672KiB、
表示されたプロセス合計が708,392/666,700KiB。全期間のプロセスピーク/ドライバ保証ではない。
実記録: examples/planet/verification/browser-long-tour-v15.json と同 -audit/-memory.json。
この完走は後から追加した地域C1・雨水Worker・村メッシュキャッシュの実画面検証を代行しない。
最新全503試験・ビルド成功。続けてこれらの統合後の実画面を確認する。


## 2026-10-10: 操作応答と表示用データの再利用

全503試験・ビルド成功。雨水の初期化/計算を1つのWorkerへ分離し、中断・再開・失敗からの
再試行を実装した。実画面は30分試験後に確認する。村の家屋/道路メッシュは追加最大1MiBの
CPUキャッシュに保持し、同じ村への再訪でダウンロードと形状の再計算を避ける。
保持量・ヒット・生成回数を記録へ追加。C1河床は旧来の無条件の直線水面を描かず、
Coreの湿潤判定を使う地形メッシュ側の水面を利用する。


## 2026-10-10: 明示地域河床の C1 接続

新しい明示ポリシー compact-c1-incision@1 を有限地域・全球チャート・ページ表示へ接続した。
直角/斜めの地域接続、斜面、合流、湖/海の錨点、保存復元を検証。全497試験とビルドが成功。
実地域2件を新しい世界IDへ明示変換し8,450地点を再開照合した。旧40保存8,819標本は
同じNode24の未変更基準版と完全一致。既存保存を黙って変更していない。
C1は地盤の条件で、C0の基礎地形・水面や動的水理を自動的に滑らかにする意味ではない。
詳細は [PLANAR_C1_BED.md](PLANAR_C1_BED.md)、実入力/実出力は
examples/planet/verification/planar-c1/report.json。
@15の30分ブラウザ試験は元の固定コードで継続し、15分の途中記録を取得済み。


## 2026-10-10: 長時間試験の中断と再実行

全488試験とビルドが成功。@14の30分試験は開始から約27分後まで稼働を確認したが、
終盤でクラウドの全ブラウザタブが消えた。原因未特定、完走結果未取得のため不合格/未完扱い。
観測したタブ+2Workerのメモリは444,560〜541,048KiB。端末全体の安定性の証明にはしない。
記録は browser-long-tour-v14-interrupted.json。
@15で30分を再実行中。測定を止めずに途中記録を保存でき、途中/完走を明示して区別する。
最初の途中JSONの取得を実ブラウザで確認済み。00:57:40 UTC以降に完走確認予定。


## 2026-10-10: 表示境界の計算量

全487試験とビルドが成功。表示の水際・道路際を共有辺ごとに再利用し、短い辺の二分探索を
表示目標1mmに合わせた。実3タイルの表面参照呼出は28,938→21,015、地盤頂点は完全一致、
表示オーバーレイの最大位置差は約0.85mm。詳細は [MESH_BOUNDARY_WORK.md](MESH_BOUNDARY_WORK.md)。
Workerに実際の生成時間と探索回数を追加。30分試験は引き続き変更前の固定版で測定中。


## 2026-10-10: 湖・海の共通参照

全486試験・ビルド成功。多地域コアに、全球の同じ湖・海を地域内外から読む明示ポリシーを追加。
5世界の実湖岸405点で、地域・地域間の隙間・保存再開・ページ参照の地盤、水位、水深、IDを照合した。
最大差は約4.7e-12m。旧地域ポリゴンの自動融合や時間発展ではない。詳細は [SHARED_WATER.md](SHARED_WATER.md)。
旧40保存8,819標本は同じNode24の基準版と完全一致。@15の5配布世界も再生成した。
変更前@14の30分ブラウザ試験が終わるまで、稼働中の表示ソースは固定している。


## 2026-10-10: 道路横断形状（generator @15）

道路の冠勾配を地盤・路面・表示・全幅離隔へ共通接続した。交差点と保存済み平坦橋は平坦区間を持つ。
全体481試験とビルド成功。5世界の全幅80,840地点、橋下水域2,080地点、家屋1,059棟の
統合検証を再実行し成功。旧40保存8,819標本は同じNode24の未変更基準版と完全一致。
Node22保存証人との丸め差の別ゲートは依然未達で、今回成功に置き換えない。
定義・雨水への接続・格子解像度と未生成排水施設の限界は [ROAD_CROSS_SECTION.md](ROAD_CROSS_SECTION.md)。
30分の実ブラウザ連続試験は変更前 @14 の固定版で継続中。@15の実画面確認とは区別する。


## Latest checkpoint (2026-10-10 JST)

Single-instance cloud work continues. Full suite: 468 pass / 0 fail; build passes.
Generator @14 adds terrain-aware side streets and keeps broad river valleys: five worlds have zero rejected
selected river links, with sea, lakes, terminal lakes, roads, houses and bridges
sharing the canonical save. Strict 100m channel-only generation remains opt-in;
old saves retain their old numerical model. See PLANET_WORLD.md for evidence.

Latest additions:
- Actual five-world villages now have 24/20/21/23/24 roads and 259/166/193/196/245 houses. Common-height junctions preserve bridge spans; wet/steep candidates are rejected.
- Repeated terrain queries and settled display frames are reused without changing sample values. Full-run benchmark counts/maxima and bounded samples now cover long runs.
- Same-world bridge foundation scenarios use actual saved supports and explicit
  soil/friction/density/scour inputs. A real browser shows 1/11 conditions failed
  at 150kPa, 11/11 at 1.1m bed loss, 0/11 at 300kPa/no loss. Automatic soil/scour
  generation, settlement, buoyancy and connections remain unresolved.
- Camera-space early raster rejection preserves 48 cases / 1,016,064 pixels.
  The latest CPU tour update p95 is 33.4ms but draw fps stays capped near 5.3;
  startup was included in that run. New benchmark controls wait for all roots
  and real geometry and record startup separately.
- LOD planning accounts for measured tile bytes before committing refinements.
- CPU rendering interpolates color/normals in perspective, including near clips;
  rasterized fps and update callbacks are reported separately. CPU tour ~4.57fps,
  not a GPU/performance pass. Display topology is cached without stale morphs.
- Browser Task Manager over 374s: main tab/workers 177420→548556→221524 KiB;
  this short recovery observation does not prove long-duration memory stability.
- Saved thin piers now optionally obstruct grid faces at exact intersection
  widths/heights. Three villages: 10/11, 16/16, 12/12 supports coupled; one pier
  lies entirely inside a cell. A real 600s browser rain run matches the same
  world. Cell storage displacement, within-cell flow, momentum/scour unresolved.

Continue remaining roadmap work without waiting for human review. Outstanding:
legacy regional/chart river continuity and explicit migration semantics; flow
below analysis-grid scale and water-body chart connection; catchment-derived
culvert design/empirical calibration; bridge foundations/scour; sampled vehicle
contact/transient dynamics; displayed error/latency and actual GPU/Windows tests.
User visual acceptance is unconfirmed, not an implementation pause.

The upstream 40-save exact Node22 witness check fails under Node24 by tiny numeric
differences also present in untouched upstream; 40 saves / 8819 samples exactly
match upstream when both run on the same Node24. Preserve both pieces of evidence.
No remote push has been made. Local branch work/planet-world is a synthetic exact
upstream-tree import followed by local commits; do not present it as remote main.

## 以下は引き継ぎ元の履歴（自動水域の保留等は上の現行方針で更新済み）

対象は Continuous Terrain Adapter **0.4.0**。現在位置は **第5段階の全球3D表示プロトタイプを実装し、表示品質・運用・受入を進める段階**。第3・4段階の個別コアは実装されているが、段階全体の完了ではない。

## 実装開始後の更新

基礎地形の勾配・曲率・丸めを含むLOD、階層順の双方向モーフ、遷移中の兄弟タイル保護を実装した。全279試験・ビルド・旧40保存再開・533ページ検証・ブラウザCore照合が成功。120秒平均99.17fps、p95 20.6ms、33.3ms超1回、地形の全体消失とストリーミングエラー0を記録した。具体的な実装範囲と未達事項は [GLOBE_LOD_QUALITY.md](GLOBE_LOD_QUALITY.md)。現在も第5段階が進行中で、次は地物・水際の誤差、隣接LODの接続と追従速度・運用の受入。

## 引き継ぎ時点で確認したこと（実装前）

README、ROADMAP、各監査対応、全球表示の指示書・設計・検証記録と現在のコードを照合した。既存の検証器でビルド、全試験、保存再開を再実行し、過去の証拠を上書きせず [今回の検証結果](examples/handoff/2026-10-10/verification.json) と [ハッシュ照合](examples/handoff/2026-10-10/integrity.json) に保存した。

| 今回の確認 | 結果 |
|---|---|
| Node | v22.23.1 |
| 全試験 | 270件成功、失敗0。[ログ](examples/handoff/2026-10-10/unit-tests.log) |
| ビルド | 成功。Core 35モジュール、旧入口30件のexport同一性、Globe 8モジュールの構文。[ログ](examples/handoff/2026-10-10/build.log) |
| 旧保存の別プロセス再読込 | 40件の元worldId・保存済み標本が一致 |
| 現行保存の別プロセス再読込 | 全球2世界と地域2件が一致。全球672表面フレーム・1,056標本、地域764地点・98表面フレーム |
| 過去の最終検証からの内容変更 | 記録対象の実装46ファイル、原ソース8件、旧入力40件のSHA-256が一致 |
| 描画用pack | demo / real-a / real-bの標高・地物ページ533件のサイズ・SHA-256が一致 |
| 過去のブラウザ測定ファイル | SHA-256一致。今回はブラウザ操作・性能測定を再実行していない |

対象フォルダおよび親にGit管理情報は見つからず、ブランチ・コミット・未コミット差分では進捗を判定できない。今回の基準は実ファイル、保存済み証拠と上記ハッシュ照合。

## ロードマップ上の現在位置

| 段階 | 引き継ぐ状態 | 主な残作業 |
|---|---|---|
| 0: 対象確認・設計 | 完了 | — |
| 1: 地域アダプタ | 定義した範囲で完了 | — |
| 2: 地域水系 | 静的モデル・明示水位の範囲で完了 | 物理水文や自動水域までの完了を意味しない |
| 3: 全球・局地詳細化 | 全球参照、投影、残差詳細化、明示chart間河川、固定細分D8補正を実装。段階全体は進行中 | 全河床のC1、chartを跨ぐ面的水域、連続的な排水解析、実生成の追加検証 |
| 4: 道路・建物統合 | 道路/橋/敷地造成、通行性、交差、暗渠候補を実装。段階全体は進行中 | 造成後の水理、暗渠容量、道路全幅・車両掃引域の離隔、構造耐力 |
| 5: 画面・運用・受入 | 2D UIと3D Paged Globeプロトタイプを実装。現在の主作業 | 厳密なLOD、境界品質、長時間・メモリ・端末・障害復帰・利用者受入 |

0.3.5でルートとCoreの二重実装、UIの通行性/交差判定、交差・暗渠の保存を補修済み。0.4.0ではECEF、Cube-Sphere四分木、WebGL 2、2 Worker、入力ページとGPUのLRU、親子モーフ、スカートを追加した。

[ENGINE_ANALYSIS.md](ENGINE_ANALYSIS.md) の246試験・二重管理・地球儀未実装という記述は過去の分析。そのPhase 1は0.3.5で補修され、Phase 4の全球表示は0.4.0でプロトタイプを実装した。分析中のPhase番号とROADMAPの段階番号は別の分類であり、現在は [ROADMAP.md](ROADMAP.md) の最新状態を基準にする。

## 次に引き継ぐ作業

直近の全球〜地表表示の依頼を継続し、**第5段階のLODと境界品質**を次の着手点とする。

1. **地物・表示中の誤差。** 基礎地形の誤差判定は実装済み。地物は振幅上限のみ。水際・造成・局所細分と生成待ち/モーフ中の実画面誤差、予算内の追従速度を進める。
2. **隣接LODの表示品質。** 階層順の双方向モーフと遷移中の兄弟保護は実装・回帰検証済み。Cube辺・隣接タイルのLOD差制約と辺ステッチ、局所細分の接続と全角度の視覚受入が残る。
3. **実画面・運用の受入。** 宇宙↔地表、日付変更線・極・Cube辺、水際・橋・敷地を反復操作し、長時間のブラウザ全体/Worker/ドライバのメモリ、PCの性能差、GPU喪失からの復帰、低速回線を測定する。数値試験と別の証拠として残す。

第3・4段階の残課題は継続管理する。`inspectEarthworkDrainage` は造成前地形から暗渠候補を診断する機能で、暗渠を水路として接続し、造成後の水位・滞水・流域を再計算するパイプラインは未実装。

**これは着手時の保留記録で、現行状態ではない。** その後の利用者指示により、新世界の湖・海・内陸終端湖は自動生成を実装した。現状は冒頭とROADMAPの最新欄を参照。

## 画面・性能の既存証拠と限界

[GLOBE_VALIDATION.md](GLOBE_VALIDATION.md) に前回の実ブラウザ測定がある。2026-10-09 JST、Chromium 155 / RTX 3070 / 1280×720 / DPR 1の120秒経路で、平均143.9fps、33.3ms超のフレーム0、ストリーミングエラー0を記録した。静止後の中心付近はL20・約0.360357m間隔で、ブラウザ頂点131標本のCore照合を記録している。

これは前回の限定した測定。今回の再計測値でも、移動中に常にサブメートル表示できる証明でもない。ブラウザ全体のメモリは未測定で、長時間・PCの性能差・全角度の視覚品質も未受入。画像は局地/メートル視点とDOM記録が存在するが、文書に挙がっていた `globe-space.jpg` と対応DOMは存在しないため、証拠一覧を訂正した。

## 起動と主要入口

作業ディレクトリで `npm run ui` を実行する。

- 全球3D: `http://127.0.0.1:3000/src/globe/index.html`
- 地域2D: `http://127.0.0.1:3000/src/ui/index.html`
- Core実装: `src/core/`。ルート入口は互換shimとして維持する。
- 全球表示: `src/globe/app.mjs`、`stream.mjs`、`mesh.mjs`、`paged-source.mjs`、`renderer.mjs`。
- 設計・残ゲート: [GLOBE_ARCHITECTURE.md](GLOBE_ARCHITECTURE.md)、[SPEC_CONTINUOUS_LOD_STREAMING.md](SPEC_CONTINUOUS_LOD_STREAMING.md)。

通常の基準確認は `npm test` と `npm run build`。`npm run verify:stage3` は現行版の検証生成物を書き直す。`npm run verify:globe` はブラウザを自動操作せず、保存済みブラウザ証拠を照合する。Core/Globe変更後は新しいブラウザ測定を取り直す必要がある。

最初の引き継ぎ確認では実装コードを変更せず、その後の利用者指示で上記のLOD・モーフ改善を実装した。**現在位置は第5段階の表示品質・運用・受入が進行中。**

### 07:21 UTC 一様な水域のLODと実画面確認

深い湖の斜視では、消失を修正しただけでは見えない水底へ精度予算を使っていた。
全補間パッチが同じ水面を選び、地盤/親モーフ地盤が完全に下にある場合に限り、一様な水面の球面誤差でLODを決める経路を追加。
局地地物・混合水域・岸・旧halo・水中カメラは通常経路に戻す。
可視地盤と一様水面を別々に数え、UIの合格条件も両方を見る。
全604試験・build成功。湖1の高度69.5m・傾斜70度・CPU265px・64MiBで352表示タイル、約35.7MiB、地盤上限1.978528px、一様水面上限0.700760px、生成待ち0、隣接違反0へ収束。水底142枚を可視地盤と分けて記録。128点のCore照合で地盤/水深差4.548e-12m以下。`browser-lake-reservoir-64mib.json`/audit/png。読み込み途中の前段階と秒数で速度比較はしない。水際や一般的な水中描画の完成とはしない。

### 07:26 UTC 最新コードの120秒巡回

120.016秒を可視状態で完走。地面消失0、隣接違反0、読み込みエラー0。128点のCore差は地盤3.936e-10m以下/水深0。CPU実描画12.373fpsで30fpsは未達。Window heap観測最大135,016,028bytes、追跡バッファ推定最大74,272,217bytes。通常解像度のNode数値試験と同時に実施した負荷条件で、速度改善比較には使わない。`browser-reservoir-120s.json`/audit。終了後Task Managerのタブ+2Workerは278,040KiB（約271.5MiB）、GPU24,428KiB、Browser71,508KiB。単一時点の観測であり全体ピーク/長時間リーク保証ではない。

### 07:29 UTC 通常解像度相当の再試験

最新3f07325の1280×720/30m/128MiB数値試験は441.802秒、2458生成/1110表示、64,045,273bytes、地盤上限1.996879pxで収束。旧330.957秒/1109表示より長い。新試験はCPUブラウザ巡回と併走しており、実装変更による悪化と競合負荷の影響は未分離。高速化成功とはしない。以前の結果を`viewport-lod-30m-128mib-before-reservoir.json`へ保存した。実GPUの待ち時間ではない。

### 07:45 UTC 実画面報告書と単独計測

`reports/planet-progress-2026-10-10.html` を作成し、画像埋込の単一HTMLとして利用者へ渡した。全球、湖広域、水面近景、村、川/橋、橋の条件、車両通行、雨/排水の8画面。未完了・撮影時読込中・初期状態を明記。実ブラウザで画像8枚読込、拡大/閉じる、各見出しへの移動を確認。GitHubへの反映は行っていない。
ブラウザ描画を止めた再試験（CPU profilerあり）は425.432秒、2458生成、1110表示、地盤1.996879px、64,045,273bytesで終了。水底を除いたタイルはこの視点では0。元の5.5分より依然長く、ブラウザ併走だけでは説明できない。プロファイルはheightRange約21.8秒、clampedAngle約21.1秒、水域上限判定本体約19.4秒などの繰り返しを示す。サンプル計測であり厳密な関数総コストではない。`viewport-cpu-profile-summary.json`。

### 08:10 UTC browser regression after tile memo

Actual cloud CPU diagnostic browser, 64MiB mesh limit: village1 at350m returned to295 visible tiles and zero pending work. Lake1 at69.5m/70° returned to352 tiles, ground1.978527393px and constant-water0.700759507px.128 Core witnesses differ by at most4.548e-12m; adjacency violations and streaming errors zero. Current mesh retention63MiB includes previously visited village views. Metadata cache3182/4096 entries, estimated3,258,368bytes. Static inspection, not a new tour/FPS or whole-process-memory pass. Evidence: browser-tile-memo-lake.json and its audit.

### 08:27 UTC exact-reference path bound reuse

CPU profiling after static tile memo showed heightRange at22.565s self-time and tileInfo at13.498s. The geometric path bound now remembers its last exact reference direction/elevation within the bounded tile entry. Any reference value change recalculates; manifest replacement clears it; resident mesh and ancestor range intersection still runs on every call. No position quantization or stale mesh range reuse.606 tests PASS /0 fail and build passed. Reference changes and live cached mesh bounds have regression tests; four-altitude selected-plan outputs match the pre-memo implementation.

The new full-resolution numeric run converged in320.408s with the same2458 meshes /1110 displayed tiles /64,045,273bytes /1.996879px. Single-run timings are diagnostic, not a controlled benchmark or real GPU response claim. The earlier memo run with profiler was334.866s; preserve it separately rather than overwriting its provenance. Browser regression subsequently passed at08:32 UTC: actual120.0067s visible CPU tour, no geometry-empty frames, adjacency violations or streaming errors;128 witnesses within3.817e-10m of Core. Actual draws12.224fps (30fps gate false), recorded Window heap peak131,796,912bytes and tracked-owned peak78,431,339bytes. These are not whole-process peaks or GPU measurements. The previously delivered report and ZIP are older snapshots.

### 08:47 UTC multi-world inspection and shoreline navigation

- Real CPU browser checks: worldB village2 converged222tiles/42.4MiB; worldA village3 converged170tiles/36.7MiB.128 witnesses per world agree with Core within1.3e-10m. Streets/houses are still visibly repetitive, and flat colors/limited scenery remain, so these checks are functional, not naturalness acceptance.
- Below-sea basin lake1 at30m/70° shows water, but64MiB has2 visible ground tiles above target (max2.013273px); constant water max1.285361px. UI correctly reports budget-limited. No tolerance inflation or false pass.
- Added lake-shore navigation using existing saved twelve-ray shore distances. It cycles approximate shore candidates, changes only the view, and does not regenerate the world. Missing/invalid metadata disables it. Actual basin shore view at69.551039,-10.341855/1500m/55° shows both land and water;438tiles/52.3MiB, zero pending work.608 tests and build passed.
- HTML report now has9 actual scenes, identifies the newer shore scene separately, and retains explicit limits. Its imagery still demonstrates a plain, insufficiently detailed shore; the navigation feature does not make the shoreline natural.

### 08:53 UTC report exercise results

The report's rain and vehicle scenes now show completed UI calculations rather than empty initial controls. Village1 rain50mm/h, open drainage and bridge obstructions/storage enabled:600s completed, water6515.42→7139.92m³. Vehicle default10km/h, width1.8m, steer26°, friction0.6, CG0.9m:21.78s completed and actual pitch/roll plot shown; dynamic contact/compression/underbody limits are violated, alongside1 static overlap candidate. Neither run is represented as a safety or global-water pass. Report retains9 scenes;07/08 screenshots and captions replaced by actual post-run states.

### 09:05 UTC rejected relief-only experiment

An uncommitted optional generator@17 comparison tried32km/200m,5km/40m,500m/3m and8m/.04m detail bands. It generated8 villages/9 lakes/39 rivers and passed two focused cases plus610 full-suite cases including those new cases. At village1 the CPU display reached445tiles/42.9MiB, but the screenshot remained a largely uniform green plain with repetitive road/building layouts. A1.6km oblique view was still refining639tiles at63.3MiB. This is not a controlled performance regression measurement. Simply increasing relief did not establish sufficient visual benefit to promote it. All profile/CLI/catalog/code and generated-comparison changes were removed from the working tree; the independent experiment is archived outside the repository. Default generator@16 and the five saved worlds remain unchanged. Current shipped suite remains608, not610. Next visual work needs to address landscape legibility and composition, not use a larger test count or noise amplitude as a substitute for naturalness.
