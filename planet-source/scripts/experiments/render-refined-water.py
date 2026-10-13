import argparse,json,numpy as np,matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.colors import LinearSegmentedColormap,Normalize
p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');a=p.parse_args();r=json.load(open(a.input))
fig,axes=plt.subplots(2,2,figsize=(14,11));fig.subplots_adjust(top=.83,bottom=.17,hspace=.3,wspace=.18)
cmap=LinearSegmentedColormap.from_list('ground',['#91ad83','#c6bb83','#a28a69','#ded9cc'])
pairs=[(r['parent'],r['context'],'Generated terrain',5e6),(r['realTerrainComparison']['parent'],r['realTerrainComparison']['refined'],'Real DEM: Tuscany (computed drainage)',2e5)]
for row,(parent,child,title,threshold) in enumerate(pairs):
 norm=Normalize(min(parent['elevation']),max(parent['elevation']))
 for col,c in enumerate([parent,child]):
  ax=axes[row,col];g=c['grid'];w=g['columns'];h=g['rows'];dx=g['cellSizeM']/1000;dy=g['cellSizeYM']/1000;z=np.array(c['elevation']).reshape(h,w)
  ax.imshow(z,extent=[0,(w-1)*dx,(h-1)*dy,0],cmap=cmap,norm=norm)
  ax.contour(np.arange(w)*dx,np.arange(h)*dy,z,levels=12,colors='#655c4c',linewidths=.35,alpha=.55)
  segments=[]
  for i,j in enumerate(c['receiver']):
   if j>=0 and c['annualFlowM3'][i]>=threshold:segments.append([(i%w*dx,i//w*dy),(j%w*dx,j//w*dy)])
  ax.add_collection(LineCollection(segments,colors='#147da6',linewidths=1.0))
  ax.set_title(f"{title}\n{'Parent' if col==0 else 'Refined, inherited catchments'}: {dx*1000:.0f} x {dy*1000:.0f} m spacing",fontsize=11)
  ax.set_xlabel('km east');ax.set_ylabel('km south')
fig.suptitle('Refinement with fixed destinations: continuity works, terrain constraints remain',fontsize=15,weight='bold')
fig.text(.08,.895,'Same terrain, twice the sampling density. Finer water routes are recomputed; old lines are not just subdivided.',fontsize=10)
fig.text(.07,.025,'All inherited outlet annual budgets conserved. Fine routing uses nearest-parent catchment membership.\nThis conservative boundary rule creates artificial obstacles: maximum routing fill is 6.4 m (generated), 68.0 m (real DEM).\nThose fills are NOT physical terrain or lakes. The refinement is diagnostic and is not accepted as finished physical water.\nBottom row: NOAA ETOPO2022 terrain; blue lines are OUR calculated drainage, not observed river centre-lines.\nSource heights are interpolated; no new surveyed terrain detail. Offline data plot, not a browser screenshot.',fontsize=10)
fig.savefig(a.output,dpi=140,bbox_inches='tight')
