# 地域の表流水モデル 0.3.4

更新日: 2026-10-09。ロードマップ第2段階の実装。静的なゲーム用モデルとして河道・河床・水面・流域・水域接続を構築する。流量、時間発展、洪水や背水の物理解法は含まない。

0.3.4ではstrip-with-smooth-banks@4を使用する。外岸の影響率をsmoothstepへ変えて、C1基礎地形の法線方向微分へ接続する。同一エッジ内の湿潤三角形の正面積重複も拒否する。内部三角形・中心線・屈曲点・合流/min合成の全C1化は未完。旧construction@1/@2/@3は元のworldIdと値で復元する。実入力の結果と範囲は [AUDIT_RESPONSE_0.3.3.md](AUDIT_RESPONSE_0.3.3.md)。

## 実装したこと

1. `connectSurfaceWater` は生成済みの基礎地形と有向河川graphを受け取り、新しい版の地形を返す。流れに沿って水面が上昇しないprofileを作り、合流点は一つの水位を共有する。表示窓や表示間隔では再計算しない。
2. 河道の中心、岸、水際から外側の地表までを三角形の帯で表現する。原地形から水底への変更は連続し、水際の水深は0になる。内部の始点・末端には半円状の閉じた端部を作るが、regional-boundaryは開口断面を保つ。メッシュは領域内に切り取り、切り取り点の水位・水深・影響率も補間する。細い川は180m/120m格子の水域maskへ潰さず、任意座標で参照できる。
3. 湖・海は自己交差のない単純な多角形の探索領域と明示した水位を持つ。凹形状とどちらの頂点順序も受け入れる。実際の水域は水位と地表の大小から決まり、探索領域内の高地は水にならない。内部の探索境界が濡れている入力は拒否し、探索境界で水を突然切らない。地域外周での切り出しは別扱い。
4. 水域に入る/出るnodeをその水位へ接続する。nodeが探索領域内の乾いた土地にある場合は自動で水域につながない。水際の人工的な接続点は `bodyId` で明示できる。
5. `fromDynamicRegionalWater` は元の `flowReceiver` に沿って `riverMask` の下流側を補完する。河川graphが途切れていた場所や孤立nodeも、元の流域の流出先へ連結する。地域外周には明示した境界nodeを置き、海や湖だとは推測しない。0.3.3では流入方向を矩形外周へ延長し、四隅のx優先を除去した。複数流入はflowAccumがあれば重み付きで、なければ等重みで集約する。外向き方向が得られなければ外向き法線を使う。境界nodeにboundaryDirectionと推定根拠を保存する。領域外の実流向を観測した値ではない。
6. 元のnode IDを保持する。補完した経路が元のedgeを分割する場合は `sourceEdgeId` で元のIDを追跡する。元の表示曲線・地物IDはsnapshotのreferencesにも残る。流域番号と流出先セル番号は元の全域格子を保持する。
7. 既定の地形snapshotは `minimal-world-continuous-terrain@2`、補間を明示する地形は@3、新しい水系は`minimal-world-surface-water@2` / `strip-with-smooth-banks@4`。斜めの境界端部では同水位の断面を接線方向に境界外へ延ばしてから切り取り、開口の片側が途切れる問題を修正した。水面profile、水域、構築方式、数値条件、流域格子、有向順序を保存し、空間索引を再構築する。有向順序は復元時にも検証する。旧構築方式、第1段階の地形@1、旧水系@1は元のworldIdと契約を維持して読める。

## 使用

```js
import { fromDynamicRegionalWater } from './dynamic-regional.mjs';

// world は既存generateRegionalの実行時出力。表示LODを変えるために再生成しない。
const terrain = fromDynamicRegionalWater(world, {
  verticalDatum: 'dynamic-runtime-unspecified-local-zero',
});
const point = terrain.sampleAt(4590, 810);
```

この入口は旧部品の海・湖を自動同定しない。旧worldの地形基準をそのまま採用し、全地域の河川をその一次流向骨格から接続する。旧worldのJSONにはTypedArrayのlengthが失われている場合があるため、旧worldのJSONをそのまま渡す入口ではない。本アダプタのsnapshotを保存・復元する。

湖・海・内陸終端湖の自動化は利用者の指定で後続に回した。旧worldには確定した海面水位がないため、標高0を海面とは仮定しない。

汎用の接続は、基礎地形に明示したgraphと水域を渡す。

```js
import { connectSurfaceWater } from './surface-water.mjs';

const terrain = connectSurfaceWater(baseTerrain, {
  riverGraph: {
    nodes: [
      { id: 'upstream', xM: 100, yM: 500 },
      { id: 'inlet', xM: 300, yM: 500, bodyId: 'lake-1' },
    ],
    edges: [{ id: 'river-1', from: 'upstream', to: 'inlet',
      points: [{ xM: 100, yM: 500 }, { xM: 300, yM: 500 }] }],
  },
  waterBodies: [{ id: 'lake-1', kind: 'lake', waterLevelElevationM: 140,
    polygon: [
      { xM: 250, yM: 350 }, { xM: 550, yM: 350 },
      { xM: 550, yM: 650 }, { xM: 250, yM: 650 },
    ] }],
});
```

上例のbaseTerrainには、水域探索境界の標高が140m以上で、接続水位が上流の地形制約と両立する地形が必要。循環するgraph、途中で上流へ上がる水位、同じ水際で異なる水位、graphの合流を持たない交差、折り返す帯状地形などは拒否する。

再現可能な湖→流出河川→海の小例は `npm run example:water`。入力は解析用に作った例で、実生成世界の湖・海を発見した証拠とは扱わない。`node example-water.mjs new-snapshot.json` で新規保存できる。

## 返す値

`sampleAt` の標高・勾配は河床を含む変更後の地表を参照する。snapshotのgroundElevationM格子には変更前の基礎地形を保持し、河道modelを重ねて変更後の地表を復元する。

- hydrologyStatus=`modeled` は今回の静的モデルによる結果。第1段階の明示水位格子は`defined`、水位未提供は`unresolved`のまま。
- groundElevationM、水面がある地点のwaterSurfaceElevationM、水深waterDepthMを別々に返す。水深は水面−地表で非負。モデル内の乾いた地点は水深0、水面と水位はnull。
- waterSourceIdsは水面に寄与した河道/水域ID。複数河道の合流点では複数IDになりうる。
- basinId / basinIndex / outletCellIndexは元の流域と流出先。流域は離散的な分類なので、流域境界でIDが変わること自体を標高の不連続とは扱わない。

## 数値条件と限界

既定は半幅1.8m、外側への岸幅3m、水深1.2m、地表と水位の余裕0.15m、profile標本間隔の上限20m。`parameters`でhalfWidthM / bankWidthM / depthM / freeboardM / profileStepMを指定できる。旧worldの実流量から校正した幅・深さではない。

0.2.2で追加した `channelSizing: { mode: 'strahler' }` を任意指定できる。元次数を保存し、補完下流へ採用次数を引き継ぐ。半幅と岸幅は次数ごと1.25倍、深さは1.12倍で、既定上限は基準半幅/岸幅の4倍、深さの2倍。倍率と上限は変更可能。次数別設定と実寸法も保存する。合流の同水位区間は接続edgeの最大幅に合わせる。仕様・分流の制限・実入力の寸法は [REFINEMENT.md](REFINEMENT.md)。

0.3.1では `interpolation: 'bounded-hermite-c1@1'` の地域基礎地形にも表流水を構築できる。河道周囲の地表下限は切り取ったBezier制御点の包絡、岸/水域境界は六次線分多項式の極値で検証する。65,536矩形/区間の作業上限を設ける。水域内は明示水位を使い、乾いた水際は地表下限を守ってfreeboardを緩和する。包絡による保守的な拒否はあり得る。基礎地形のC1と、河床/岸を含む全地表のC1保証は区別する。詳しくは [AUDIT_RESPONSE_0.3.0.md](AUDIT_RESPONSE_0.3.0.md)。0.3.2の全球投影には専用のconnectGlobalSurfaceWater/connectProjectedSurfaceWaterを追加し、profile solverを共用する。直接参照の球面場に対する勾配上限検査と単一chartの制限は [GLOBAL_WATER.md](GLOBAL_WATER.md)。

水位は細分した河道周辺の基礎地形で上限を決め、水域接続の水位を下限として解く。合流付近の同一水位区間を設ける。これにより急な地形を深く掘り込むことがあり、今回の実地域2件で中心の最大掘り込みは約13.06m/13.25mだった。湖・海の指定例では約35.97m。契約の成立を自然な地形・妥当な施工量の合格と取り違えない。

帯が局所的に折り返す形では、幅を最大1/4まで縮めて再評価し、その比率をdiagnostics.geometryWidthScalesに保存する。これで成立しなければ拒否する。今回の実地域2件では幅の縮小は0件。交差/水面の不整合は空間索引の構築時と参照時に検出する。

旧表示曲線には、合流前の重なりと急な折り返しがあったため、水系の構築には元の有向D8骨格を採用した。D8の方向バイアスは残る。滑らかな曲線化と見た目の自然さは未検証。

水域の探索領域は3～128頂点の単純な多角形で、最大128水域。穴・複数リングは未対応。実際の湖岸は地形との交線なので、探索多角形そのものを湖岸として描くものではない。線分が凹領域を複数回横切る場合は区間を分け、接続端から最初に領域を出るまでを同水位区間として扱う。河川水位と水域水位の制約が矛盾する背水等は入力エラーにする。物理的な背水・流量・季節・侵食・貯留の計算は後続の拡張事項。

## 水位格子との併用

基礎地形にwaterLevelElevationM格子があるときは、役割を明示する。

```js
const terrain = connectSurfaceWater(baseWithWaterGrid, {
  riverGraph, waterBodies,
  waterLevelRole: 'surface', // または 'groundwater'
});
```

`surface`は広域の潜在表流水位。河道/湖/海と重なる場合は高い方を水位にし、変更後の河床から水深を計算する。広域面が勝った地点のwaterSourceIdsはwater-level-gridになる。入力格子の水位が任意に増減する場合、合成後の水面全体が下流へ単調になる保証はない。河道profileの単調性と静的な広域面の合成を区別する。

`groundwater`は地下水位としてgroundwaterLevelElevationMに返し、表流水の水位には使わない。浸透・湧出・背水の計算を意味しない。地下水格子しかない場合は地表水のhydrologyStatusとsurfaceKindをunresolved、水深をnullとして返す。河道modelもある場合はそのmodelの表流水を参照する。

指定した役割と格子の値はsnapshotに保存される。sampleAtはwaterLevelRole、staticWaterLevelElevationM、groundwaterLevelElevationMも返す。旧来の格子単独入力で役割指定がない場合は、表流水位という既存の意味を維持する。格子と河道modelの併用で役割未指定の場合は拒否する。

## 道路交差と指定橋高

```js
import { inspectRoadCrossings } from './road-crossings.mjs';

const report = inspectRoadCrossings(terrain); // references.roadsを確認
const checked = inspectRoadCrossings(terrain, {
  bridges: [{ crossingId: report.crossings[0].crossingId,
    worldId: terrain.worldId, deckElevationM: chosenDeckHeight }],
});
```

独自の道路は`roads: [{id, points: [{xM,yM}, ...]}]`で渡す。既定は最大標本間隔2m、観測水面からの余裕clearanceM=1m。実地域の検証では最大間隔10mを使用した。河道三角形と水域探索境界の交差イベントも参照し、固定間隔の間にある細い河道を確認する。格子カットと、表流水格子の線分上の極値も参照する（双線形は二次、C1は六次）。traceSurfaceSegmentは距離付きsample列を返す。どちらの入口にも標本数上限がある。

結果は道路ID、worldId、濡れた参照点の距離区間、前後の乾いた参照点、水源ID、観測した最大水面高、その水位とclearanceMからのrequiredDeckElevationMを含む。橋高未指定はbridge-height-required、観測点の必要高未満ならinsufficient-sampled-clearance、それ以上ならsampled-clearance-met。指定橋高は同じworldIdが必要で、未検出のcrossingIdは拒否する。交差区間の端は参照点であり、厳密な湖岸/川岸座標とは扱わない。

橋高の照合は観測点に対する結果。道路全幅、橋台、桁、道路勾配、洪水、構造の受入を保証せず、requiresStage4Reviewはtrueのまま。未解決水文で候補0件という結果も、乾いた道路の証明ではない。結果全体のhydrologyStatusを確認する。未知水深の点は乾いた進入路にせず、unresolvedWaterSamplesへ数える。道路や地形を自動修正・保存する処理は含まない。

投影地域viewにも明示した地域メートル道路を渡せる。基礎全球だけなら水深nullで、固定間隔/中点による診断を行う。0.3.2の明示water chartと同じ投影ならメッシュ/水域/既知範囲境界のイベントも使う。別投影は有限間隔の参照のみ。既定道路は空集合。結果と橋高指定にはregionIdも付く。明示範囲の外の水深は未解決のまま。接口・保存再開・検証精度は [GLOBAL_WATER.md](GLOBAL_WATER.md)。

## 検証結果（2026-10-09）

`npm run verify:water` は256MiB heap・子プロセスごと30秒、直列で実行する。現在版の出力先は`examples/surface-water/0.3.4/`。以下の表は保持した旧版の [examples/surface-water/verification.json](examples/surface-water/verification.json) に対応する。0.3.4のverify:stage3は旧10件と0.3.3の2件の元worldIdでの復元を照合し、外岸を修正した新規実地域2件も別に構築・再読込した。

| 入力 | 補完後node/edge | 実際に確認した合流 | 中心線参照点 | 水位逆転 / 水深違反 | 保存再読込 |
|---|---:|---:|---:|---:|---:|
| 実生成world-a、96×72・120m | 107 / 93 | 16 | 8,664 | 0 / 0 | 395地点一致 |
| 実生成world-b、96×72・120m | 95 / 82 | 12 | 7,952 | 0 / 0 | 365地点一致 |
| 明示した湖・海の例 | 4 / 2 | 試験対象なし | 148 | 0 / 0 | 55地点一致 |
| 凹水域の例 | 0 / 0 | 試験対象なし | 試験対象なし | 試験対象なし | 52地点一致 |
| 表流水格子と河道の併用例 | 2 / 1 | 試験対象なし | 168 | 0 / 0 | 55地点一致 |
| 地下水格子と河道の併用例 | 2 / 1 | 試験対象なし | 168 | 0 / 0 | 55地点一致 |
| world-a、Strahler次数別断面 | 107 / 93 | 16 | 8,664 | 0 / 0 | 395地点一致 |
| world-b、Strahler次数別断面 | 95 / 82 | 12 | 7,952 | 0 / 0 | 365地点一致 |
| world-a、C1基礎地形 | 107 / 93 | 16 | 8,664 | 0 / 0 | 395地点・49表面フレーム一致 |
| world-b、C1基礎地形 | 95 / 82 | 12 | 7,952 | 0 / 0 | 365地点・49表面フレーム一致 |

実地域の全中心線参照点で元の流域番号・流出先セルと一致した。合流nodeと各incident edgeの水位も一致。孤立nodeと未解決の内部末端は実地域2件で0、地域外周への流出は14件/13件だった。外周の先が海・湖であることは未確定。

0.3.1時点の単体試験は69件PASS。0.3.2の有限地域回帰実行では80試験と全10ケースを照合し、その後、全球の内部湖岸の1試験を追加して全81件を別の全球水系検証で確認した。全10表流水ケースでLOD共通49地点、隣接窓の境界31地点が一致。再読込はgeneratorを読み込まない別プロセス。計2,497地点・C1河川98表面フレームと道路交差の結果が一致し、旧水系@1の353地点とworldIdも一致した。0.3.3では全94件PASSで、これら旧保存値の一致も維持した。

実地域27流出口の開口断面81地点で水深が正。14道路の19,995参照点から27交差候補を確認し、保存再開後の診断も一致した。実地域の湖/海は両ケースとも0件で、自動同定の証拠ではない。水位併用の人工例には内部末端が各1件残り、終端湖の計算をした例とは扱わない。

上記の流出口・道路件数は一律断面の実地域2件。次数別の2件も27流出口・81地点で開口を維持し、28合流点・16,616点で違反0、元次数と下流への伝播を確認した。幅縮小は0件。次数別の最大中心掘り込みは約13.20m/13.39mに増えており、掘削の自然さの問題は残る。

道路診断を含む最新の実行時間と最大RSSは検証記録を参照。0.2.0の道路診断なしの時間と同じ負荷として比較しない。構築処理の重複は減らしたが、全パイプラインが半分の時間になる保証はない。元ソース2ファイルのSHA-256は試験前後とPROVENANCEで一致した。

0.3.3の新しいC1実地域2件では27出口中16位置を変更し、27出口・81開口地点の水深が正。28合流点・16,740中心線参照点で水位逆転/水深違反0、764地点・98表面フレームと道路診断が別プロセスで一致した。全球から書き出した8有限地域では明示表流水4例・地下水4例を接続した。出典維持、推定流向の限界と証拠は [AUDIT_RESPONSE_0.3.2.md](AUDIT_RESPONSE_0.3.2.md)。

C1基礎の河川の最大中心掘り込みは約12.95m / 13.26m、従来の指定湖海例は約35.97mで、校正は未完。全球の新入口には中心線上限を追加したが、有限地域の旧builderへ遡って適用していない。描画・人による自然さ、chartを跨ぐ河川/重複範囲、全河床のC1化、独立した有限地域間の接続、実生成の湖/海の自動同定、建物/道路の接地、全seed・解像度・既存部品全試験は後続。第3段階全体は進行中。

0.3.4の全107試験と実地域2件は [examples/audit-0.3.3/0.3.4/verification.json](examples/audit-0.3.3/0.3.4/verification.json)。28合流・16,740参照点で違反0、764地点・98表面フレーム・道路診断を再読込照合した。全球は独立した複数chartまで進んだが、chartを跨ぐ河川と全河床C1化は後続。水域自動化は引き続き延期する。
