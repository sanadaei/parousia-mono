# 全球から局地への接続（第3段階）

更新日: 2026-10-09。版0.3.4。第3段階の基礎接続・投影線分/道路診断・独立した複数の明示水系chart・有限地域格子への近似書き出しを実装した。詳細成分を格子線/極域にも残す新方式を追加した。旧geography-liteの原ソースは維持する。水域の自動化は利用者の指定で後続に回す。明示水系は [GLOBAL_WATER.md](GLOBAL_WATER.md)、今回の変更は [AUDIT_RESPONSE_0.3.3.md](AUDIT_RESPONSE_0.3.3.md)。

## 今回の契約と検証条件

- 既存physical格子の中心は、経度 `360*(x+.5)/width`、緯度 `90-180*(y+.5)/height`。横周期、行は北から南。これを一つの全球snapshotへ取り込む。
- 惑星は呼び出し側が指定する半径の球。半径・元の標高基準名・出力の標高基準名・明示した標高offsetを保存する。測地楕円体/ジオイド変換は対象外。
- 基礎標高は周期C1補間。極点は最北/最南行の平均へC1で収束させる。元の格子中心を保持する。元生成器の継ぎ目の大きな標高差を自然な地形へ直したとは扱わない。
- 固定した波長/振幅の球面詳細化を重ねる。新方式@2は格子中心で補正0、成分を総振幅以内で制限し、格子線/極域にも残す。旧方式@1は格子中心線/極域で補正0、四隅の標高範囲を保つ。保存された方式で評価し、表示LODで帯域や地形を再生成しない。実測の微地形ではない。
- 元の排水graphから海への出口セルを求め、全球/局地で同じ流域IDを返す。流路の隣接・循環を検証する。元の海陸・湖充填深度は出典情報として保存し、表流水位へ自動変換しない。
- 地域viewは球面の方位正距図法。全球場を直接参照し、切り出し格子の再補間をしない。中心・投影半径・範囲を保存する。投影の角距離上限は0.1rad。view境界で差分距離を変えない。
- 任意地点、粗格子境界、経度の同値表現、日付変更線、両極、元中心値、詳細化の上限、LOD/隣接窓、投影往復、流域同一性、保存後の別プロセス再読込を検証する。

## 使用

```js
import {
  fromGeographyLite, createProjectedTerrainView,
  serializeGlobalTerrain, restoreGlobalTerrain, restoreProjectedTerrainView,
} from './global-terrain.mjs';

// world は既に生成済みのgeography-lite出力。
const global = fromGeographyLite(world, {
  radiusM: 6371000, // この例で呼び出し側が選ぶ球の半径
  sourceVerticalDatum: 'geography-lite-generated-zero',
  verticalDatum: 'geography-lite-generated-zero',
  elevationOffsetM: 0,
  detailBands: [
    { id: 'hills', wavelengthM: 20000, amplitudeM: 20 },
    { id: 'relief', wavelengthM: 5000, amplitudeM: 4 },
  ],
});
const region = createProjectedTerrainView(global, {
  centerLatDeg: 14, centerLonDeg: 179.99,
  maxRadiusM: 100000,
  bounds: { minXM: -6000, minYM: -6000, maxXM: 6000, maxYM: 6000 },
});
const point = region.surfaceFrameAt(3000, 1000);
const geo = region.toGeographic(3000, 1000);
const local = region.toLocal(geo.latDeg, geo.lonDeg);
const reopened = restoreGlobalTerrain(serializeGlobalTerrain(global));
const reopenedRegion = restoreProjectedTerrainView(JSON.stringify(region.toSnapshot()));
```

`fromGeographyLite`はgeneratorを起動しない。入力の版・格子寸法・macroScale・macroセルの位置を検証し、粗い陸海混在セルの平均標高ではなくphysical.elevationMを取り込む。原点は経度0、経度は正規化して[-180,180)へ返す。±180は同じ座標。元格子の左右端の接続は0/360度の経線であり、±180度の表示上の折り返しとは区別する。

汎用入口は `createGlobalTerrain` と `GLOBAL_TERRAIN_SCHEMA`。地域の@1/@2/@3とは別の `minimal-world-global-terrain@1` を使う。球面契約の異なる補間・原点・行順を暗黙に読み替えない。

## 基礎補間と詳細化の意味

周期補間は左右各2列の周期的な余白を使い、既存の共有導関数Hermiteを再使用する。経度0の両側で同じ標高と一次導関数になる。極点は元データに標本がないため、最端行の平均を境界条件として採用する。半行幅のpolar capでsmoothstep接続し、極点の標高が経度に依存しないようにする。極点に元セル・流域を恣意的に割り当てず、これらのIDはnull、basinStatusはundefined-at-pole。

詳細化は球の3D座標上のC1格子ノイズで、経度の継ぎ目を持たない。波長は格子の特徴距離で、厳密なFourier帯域制限ではない。最大4スケールを固定し、順序はIDで正規化する。

0.3.4のfromGeographyLiteの既定は`anchored-spherical-residual-bands@2`。各バンドの球面ノイズNから、元セル中心のNの周期Hermite/極域cap補間Hを引き、amplitudeM×(N−H)/2を加える。N/Hは±1以内なので、補正の絶対値は総振幅A以内。中心の標高を保ちながら、格子線全体や極域capで成分を消さない。C1の接続と固定LOD契約を維持する。合成標高は局所四隅の範囲を超え得る。元流向は再計算しない。

旧`bounded-spherical-bands@1`は各パッチで`16*t²*(1-t)²`を両軸に掛け、格子中心線の補正値と一次導関数を0にする。元標高・C1のパッチ接続を保つ。fromGeographyLiteでdetailMethodとして旧方式を指定でき、createGlobalTerrainのmethod省略も旧方式として扱う。旧snapshotのworldIdと値は変更しない。

旧方式@1では、四隅の最小/最大をmin/max、基礎標高をz、振幅の合計をAとすると、補正の予算は `(z-min)*(max-z)/(max-min) * min(1,4*A/(max-min))`。これに±1以内の重み付きノイズと境界係数を掛ける。補正はA以内で、最終標高も四隅の範囲内。四隅が同じ高さなら補正0。極域capでは補正を入れない。両方式とも明示した標高offsetは合成後に加える。

旧方式@1は四隅が全て正/負のパッチの標高符号を維持する。新方式@2は振幅を制限する契約で、符号や等高線を固定しない。両方式とも陸海混在パッチの0m等高線や湖岸を固定する保証はない。元格子の標高保持は、粗セルの平均値や集水面積、詳細化後の流向まで保持する証拠ではない。

表示LODは参照点の数だけを変える。全ての詳細スケールを同じように評価し、細かいスケールを省いて別の地形にしない。粗い表示のaliasingや描画用フィルタ・mesh LODの品質は第5段階の課題。細かい補正は新しいゲーム用地形で、実測の微地形ではない。

## 座標、値、保存

global.sampleAt(latDeg, lonDeg)は、groundElevationM、baseGroundElevationM、detailElevationM、gradientEastNorth、slopeMPerM、元セル/粗セル/下流/出口、basinId、地形特徴IDを返す。勾配は球面上の東西・南北への固定メートル距離から差分する。

region.sampleAt(xM, yM)は同じ全球場を読み、regionId、xM/yM、投影座標でのgradientを追加する。地域のslopeMPerMとsurfaceFrameAtの法線・曲率は投影平面上の高さ場に対する値。globalの東西/南北勾配とは座標基底が異なる。法線・曲率の算術は既存地域アダプタと共通化した。

投影の中心からの距離は球面距離。中心から離れると横方向の距離は変形するため、maxRadiusMは半径×0.1以下、既定はmin(100km,半径×0.1)。地域boundsは投影半径の内側に固定差分用の余裕が必要。勾配・曲率を地域boundsの端で切り詰めず、同じ全球場を使って求める。toLocal/toGeographicは投影範囲内の座標変換で、sampleAtはさらに地域boundsで制限する。

全viewのworldIdは一つの全球snapshotのID。regionIdはworldIdと投影・boundsから求める。別のboundsのviewではregionIdが違うが、同じ投影座標の標高・勾配・曲率・流域は一致する。異なる投影中心同士の同地点照合では、標高と元の流域を比較し、投影の丸め誤差と勾配の基底差を区別する。

globalとregionのJSON保存・復元は専用APIを使う。regionのsnapshotは全球snapshotと投影契約を含む。復元時にはworldId/regionId、源の排水出口、投影の惑星半径を再検証する。関数・ノイズキャッシュ・generatorは保存しない。既存restoreTerrainは有限地域用のまま。全球viewを直接有限地域のconnectSurfaceWaterへ渡すことはできない。全球へ直接水系を接続する専用入口か、exportProjectedCanonicalRegionで別worldIdの有限地域snapshotを作る入口を選ぶ。書き出しは格子中心で元標高を保持し、中心以外は近似補間する。

0.3.1でregionの`traceSurfaceSegment(a,b,{maxStepM,maxSamples})`を追加した。a/bは{xM,yM}。地域bounds内の線分を固定間隔と中点で参照し、worldId/regionId・lengthM・距離付きsampleを返す。予算上限は262,144標本。有限地域と標本予算/座標計算を共有する。基礎全球@1だけのviewは水位/水深nullで、水系イベントを持たない。0.3.2の明示water chartと同じ投影ではメッシュ/水域/既知範囲境界のイベントも加える。異なる投影は有限間隔の参照のみ。`inspectRoadCrossings(region,{roads})`へ明示的な地域メートル道路を渡せる。既定道路は空集合。未知水深はunresolvedWaterSamplesに数え、交差0件を乾燥の証拠にはしない。投影地域の橋高指定にはregionIdも要求する。

半径は1～1e9m、元標高とoffsetの絶対値は1e7m以下。derivativeStepMは正で、半径の1e-12以上・0.01未満。物理格子は131,072標本、表示窓は262,144点まで。これは入力上限であり、最大規模の性能合格ではない。

## 排水・水域・標高基準

physical.downstreamを全域で検証し、海側セルを出口として元の排水先を求める。循環・自己接続・非隣接の受け手は拒否する。陸上の-1終端は未解決として保存する。basinIdは元のsourceWorldIdと出口番号で、地域view・詳細スケール・出力datumを変えても同じ元入力の流域を保持する。源の海陸/充填深度はsourceLandMask/sourceLakeFillDepthMに保存し、値が未提供の充填深度/流量指標はnullのまま。

元の海陸maskと湖充填深度は出典情報。基礎全球@1は水面を作らず、global/regionのhydrologyStatus・surfaceKindはunresolved、水深と水位はnull。明示water chartは指定範囲だけをmodeledとして、範囲外は未解決を維持する。湖充填地点の検証を実際の湖岸・水面の受入とは扱わない。詳細化後の地表から排水/流域を再計算していない。元の河川graphを自動抽出して全球の滑らかな河床へ接続する保証も後続に残る。

sourceVerticalDatumとverticalDatumを必須にし、地表へ明示したelevationOffsetMを加える。非0offsetには異なる基準名が必要。これは呼び出し側が与えたoffset変換で、楕円体・ジオイド・他生成器の未知の基準を自動較正する機能ではない。元の地域worldとの水位/標高の混合を自動で許可しない。

## 検証結果と現在位置

0.3.1時点の`npm test`と`npm run verify:global`で全69件PASS。旧58件にC1水系/境界極値/丸め、投影線分/道路の11試験を追加した。周期/極点、標高範囲・補正上限、元の排水、datum/ID、投影往復、窓/LOD、保存と異常入力を確認。共有した法線/曲率の計算は、0.3.0時点で0.2.2の保存済みC1実地域306フレームとも一致した。0.3.2では明示全球水系の12試験を加えて81件、0.3.3では書き出し等の13試験を加えて全94件PASS。実入力の書き出し8地域と旧全球12viewの保存互換はverify:auditで記録する。

旧geography-liteのaudit-a/audit-b、粗24×12・physical48×24を実生成して検証した。

| 確認 | 実測 |
|---|---|
| 元の標高・元セル・排水出口の保持 | 計2,304セルで一致 |
| パッチ内の標高範囲と24mの補正上限 | 計4,096地点。最大補正約16.36m / 15.13m |
| 地域view | 各6地域、計12。粗セル境界/日付変更線、元格子の横継ぎ目、元の海岸/湖充填地点、両極 |
| LODと隣接窓 | 各地域49共通地点・31境界地点で一致 |
| 全球と地域の元流域 | 各地域49地点で一致。極点は両側とも未定義 |
| 球面↔地域の往復 | 最大約9.39e-9mの数値差（測地精度の保証ではない） |
| 別プロセスのJSON再読込 | 全球138地点・地域960表面フレームで一致 |
| 投影線分/道路の別プロセス再読込 | 計228線分標本・12道路診断で一致。水深は未解決 |
| 原ソース | geography-liteの6ファイルと地域runtimeの2ファイルがPROVENANCE/試験前後で一致 |

上記の旧版記録は [examples/global/verification.json](examples/global/verification.json)。子プロセスは256MiB heap・30秒、生成は直列。元の入力オブジェクトの内容も変わらなかった。0.3.4の新規読み込み・残差詳細化・12viewの構築/再開は [examples/global/0.3.4/verification.json](examples/global/0.3.4/verification.json)。旧snapshotは保持し、元worldIdでの互換性をverify:stage3で照合した。

元格子の横端の標高差はaudit-aで平均約1,507m・最大2,647m、audit-bで平均約447m・最大1,456mのまま。連続な補間が、その急な源の遷移を自然な大陸へ修正した証拠ではない。元地名の重心問題、詳細化後の排水、C1河床、chartを跨ぐ河川/重複範囲、描画と自然さ、全seed/解像度・既存部品全試験は未検証。

現在は第3段階の基礎接続・独立した複数chart・有限地域への近似書き出しまで進み、第3段階全体は進行中。0.3.4は2世界・8chartの672表面フレーム、旧40snapshotの保存互換を照合した。chartを跨ぐ河川・全地表の滑らかさ・排水再計算・大域制約は後続で、水域自動化は引き続き延期。建物・道路接地は第4段階、実画面と受入は第5段階。今回の対応と証拠は [AUDIT_RESPONSE_0.3.3.md](AUDIT_RESPONSE_0.3.3.md)。
