# Offline plot of generated measurements, not an image-generation reference.
import argparse,json,numpy as np,matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap,Normalize
from matplotlib.collections import LineCollection
p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');args=p.parse_args();r=json.load(open(args.input))
cmap=LinearSegmentedColormap.from_list('relief',['#91ad83','#c6bb83','#a28a69','#ded9cc']);norm=Normalize(min(r['terrain']['elevation']),max(r['terrain']['elevation']))
fig,axs=plt.subplots(2,3,figsize=(16,12));fig.subplots_adjust(top=.88,bottom=.18,wspace=.18,hspace=.22)
master=r['terrain']['grid'];width=(master['columns']-1)*master['cellSizeM']/1000;height=(master['rows']-1)*master['cellSizeM']/1000
for ax,index in zip(axs.flat,[0,1,3,4,6,7]):
 c=r['cases'][index];g=c['grid'];w=g['columns'];h=g['rows'];dx=g['cellSizeM']/1000;dy=g['cellSizeYM']/1000;z=np.array(c['elevation']).reshape(h,w)
 ax.imshow(z,extent=[0,width,0,height],origin='upper',cmap=cmap,norm=norm,interpolation='nearest')
 xy=lambda i:(i%w*dx,height-i//w*dy)
 segments=[];lw=[]
 for i,j in enumerate(c['drainage']['receiver']):
  area=c['drainage']['routedSupplyM3PerYear'][i]/.1/1e6
  if j<0 or area<50:continue
  segments.append([xy(i),xy(j)]);lw.append(min(2.5,.3+np.log10(1+area)*.4))
 ax.add_collection(LineCollection(segments,colors='#287fa7',linewidths=lw,alpha=.9))
 path=[xy(q['cell']) for q in c['path']]
 if len(path)>1:ax.plot(*zip(*path),color='#f08835',lw=2.4,label='same-source trace')
 ax.scatter(*path[0],c='#d12754',s=30,zorder=5)
 ax.set_title(f"Spacing {g['cellSizeM']/1000:.2f} km / {w} x {h}\nSource snapping: {c['sourceSnapDistanceM']/1000:.2f} km",fontsize=11)
 ax.set_xlabel('km');ax.set_ylabel('km')
fig.suptitle('Reducing the gap: water is recalculated on the same frozen terrain',fontsize=17,weight='bold')
fig.text(.08,.925,'Same seed, location, 127 x 127 km context and drainage solver. No terrain regeneration between panels.',fontsize=11)
cax=fig.add_axes([.2,.115,.6,.017]);fig.colorbar(plt.cm.ScalarMappable(norm=norm,cmap=cmap),cax=cax,orientation='horizontal',label='Elevation (m); colours do not indicate vegetation')
fig.text(.07,.018,'Blue: drainage with >= 50 km² contributing area. Orange: flow trace from the same geographical source; pink: snapped grid source.\nCoarse grids can place that source on the survey edge, hiding its route. All outer exits are unresolved survey boundaries.\nTerrain source spacing is 1 km. The 0.61 km panel interpolates it; it does not contain new sub-kilometre landforms.\nThis is a resolution diagnostic, not finished nested watershed integration or a browser screenshot.',fontsize=10)
fig.savefig(args.output,dpi=140,bbox_inches='tight')
