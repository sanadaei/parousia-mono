from pathlib import Path
import json,numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams['font.family']='Noto Sans CJK JP'
P=Path(__file__).resolve().parent
s=json.loads((P/'paris/comparison.json').read_text())['stages']
fig,axes=plt.subplots(2,3,figsize=(13,11),layout='constrained')
for row,name in enumerate(['real','generated']):
 for col,idx in enumerate([0,3,6]):
  t=s[idx];g=t['grid'];w=g['columns'];h=g['rows'];x=np.linspace(-t['widthM']/2000,t['widthM']/2000,w);y=np.linspace(t['heightM']/2000,-t['heightM']/2000,h);z=np.array(t[name]['elevation']).reshape(h,w);ax=axes[row,col];im=ax.pcolormesh(x,y,z,shading='nearest',vmin=0,vmax=250,cmap='terrain');ax.set(xlim=(x[0],x[-1]),ylim=(y[-1],y[0]),aspect='equal',xlabel='East (km)',ylabel='North (km)');ax.set_title(f"{'パリ盆地の実標高' if row==0 else '生成結果'} | {w} x {h}\nspacing {g['cellSizeM']/1000:.2f} x {g['cellSizeYM']/1000:.2f} km",fontsize=11)
fig.colorbar(im,ax=axes,shrink=.6,label='Elevation (m), one shared absolute scale')
fig.suptitle('広域から局所へ：低起伏の実地形と同じ縮尺で比較\n全パネル 113.908 × 156.368 km・標高と距離の引き伸ばしなし',fontsize=15)
fig.savefig(P/'primary-lowland-stages.png',dpi=180)
