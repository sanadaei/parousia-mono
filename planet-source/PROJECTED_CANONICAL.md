# 投影viewから有限地域への書き出し（0.3.3）

更新日: 2026-10-09。`exportProjectedCanonicalRegion`は、基礎全球の投影viewをセル中心格子へ明示的に書き出す。既存の有限地域水系・表流水/地下水格子を使う入口で、返り値はcanonical snapshot。直接参照する全球viewも維持する。

```js
import { exportProjectedCanonicalRegion } from './global-terrain.mjs';
import { createTerrainAdapter, serializeTerrain, restoreTerrain } from './index.mjs';
import { connectSurfaceWater } from './surface-water.mjs';

// baseView は createProjectedTerrainView(baseGlobal, ...) の結果。
const snapshot = exportProjectedCanonicalRegion(baseView, {
  cellSizeM: 200,
  // bounds省略時はbaseView.bounds。範囲はcellSizeMの整数倍。
  interpolation: 'bounded-hermite-c1@1',
  references: { roads: callerMetricRoads },
  // 任意: セルごとの有限なwaterLevelElevationMとwaterLevelRole。
});
const base = createTerrainAdapter(snapshot);
const water = connectSurfaceWater(base, {
  riverGraph: callerMetricGraph,
  waterBodies: callerExplicitBodies,
});
const reopened = restoreTerrain(serializeTerrain(water));
```

出力のx/yは元viewの投影メートル座標を保持し、原点を指定boundsの左下へ置く。2行×2列以上、262,144セル以内。範囲・標本数・補間・差分距離・参照資料・呼び出し側の水位格子は参照開始前に検証する。既定の補間はC1、bilinear@1も明示選択できる。

出力は**同じ全球の近似を表す別worldId**。書き出しのセル中心では元viewの地表値と完全一致し、それ以外は選んだ補間の近似になる。格子間隔・範囲・補間を変更した書き出しは別の世界版。固定した書き出しの表示LOD・表示窓では同地点の値を変えない。有限地域の外側半セルは従来の一定値延長なので、その棚も直接全球参照とは区別する。

出典は`references.projectedSource`に保存する。元worldId/sourceWorldId/regionId、投影、範囲、方式、セルごとの元セル・macroセル・流域ID・全球の流出口番号・地形特徴IDと対応する地物情報を保持する。これらは**書き出し中心の元全球分類**で、局地の排水を再計算した分類ではない。元の全球流出口番号を有限地域のbasins.outletCellIndicesへ転用しない。必要な局地basinsは別途、有限地域の座標契約で構築する。

河川・道路・集落の局地配置は呼び出し側が同じ投影座標で渡す。元の地理特徴のセル所属は参照資料であり、自動配置や接地をした結果ではない。

既定の表流水位はnull。海陸mask・湖充填深度から水位を推測しない。呼び出し側が全セルの水位を渡す場合は、waterLevelRoleをsurfaceまたはgroundwaterで指定できる。既存の有限地域builderで河道と合成できる。これは全球全体の地下水・広域水位chartの追加ではない。

書き出しは基礎全球@1のviewに限定する。既に水系を重ねた部分既知の全球水系を、未知水深と乾いた地点が混在する単一格子へ暗黙に変換しない。先に基礎viewを書き出して有限地域で水系を構築するか、既存の直接全球水系APIを使う。

0.3.3時点の検証は [examples/audit-0.3.2/verification.json](examples/audit-0.3.2/verification.json)。実全球2入力・8投影で28,800中心の地表・元流域/流出口/地物IDを保持し、表流水4例・地下水4例と有限地域河川を接続した。各例49点のLOD一致、31点の隣接境界一致、計672表面フレーム・道路診断・出典表の別プロセス再読込を確認。中心以外の36地点/例の比較で最大差は約0.015473mだった。これは観測点の差で、全域の誤差上限や実測精度の保証ではない。0.3.4でもこれら8snapshotの元worldId/保存witness値の一致を維持した。

現在は第3段階が進行中。書き出しによる有限地域との接続は完了したが、複数の近似地域を継ぎ目なく接続する契約、排水再計算、全河床C1化は残る。建物・道路接地は第4段階、実画面・利用者受入は第5段階。
