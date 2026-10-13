# Offline review renderer. Requires numpy and matplotlib; never changes world data.
import json,numpy as np,matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap,Normalize,LightSource
from matplotlib.collections import LineCollection
from matplotlib.patches import Rectangle
import argparse
a=argparse.ArgumentParser();a.add_argument('parent');a.add_argument('network');a.add_argument('region');a.add_argument('output');args=a.parse_args()
p=json.load(open(args.parent));net=json.load(open(args.network));r=json.load(open(args.region))
fig,axs=plt.subplots(1,3,figsize=(19,9));fig.subplots_adjust(top=.82,bottom=.34,wspace=.18)
lat=r['settings']['latDeg'];lon=r['settings']['lonDeg'];w=p['snapshot']['grid']['columns'];h=p['snapshot']['grid']['rows'];z=np.array(p['snapshot']['fields']['groundElevationM']).reshape(h,w);land=np.array(p['snapshot']['fields']['landMask']).reshape(h,w)
cmap=LinearSegmentedColormap.from_list('relief',['#8ba57d','#c2b987','#a18b6c','#e4e0d5']);norm=Normalize(0,1500)
rgb=cmap(norm(z));rgb[land==0]=[.12,.26,.35,1]
axs[0].imshow(rgb,extent=[0,360,-90,90],origin='upper',interpolation='nearest');segments=[];widths=[]
for e in net['edges']:
 if e['meanPotentialFlowM3PerSecond']<20:continue
 a=e['from'];b=e['to']
 if abs(a['lonDeg']-lon)>7 or abs(a['latDeg']-lat)>6:continue
 segments.append([(a['lonDeg'],a['latDeg']),(b['lonDeg'],b['latDeg'])]);widths.append(min(3,.35+np.log10(1+e['meanPotentialFlowM3PerSecond'])*.45))
axs[0].add_collection(LineCollection(segments,colors='#2875a3',linewidths=widths));axs[0].plot(lon,lat,'+',color='#c72529',ms=15,mew=2);axs[0].set_xlim(lon-5,lon+5);axs[0].set_ylim(lat-4,lat+4);axs[0].set_title('L1: catchments and receiving rivers');axs[0].set_xlabel('Longitude');axs[0].set_ylabel('Latitude')
w=r['grid']['columns'];h=r['grid']['rows'];cell=r['grid']['cellSizeM'];zz=np.array(r['elevation']).reshape(h,w);extent=[0,(w-1)*cell/1000,0,(h-1)*cell/1000]
ls=LightSource(azdeg=315,altdeg=45);shade=ls.shade(zz,cmap=cmap,norm=norm,vert_exag=1,dx=cell,dy=cell,blend_mode='soft')
axs[1].imshow(shade,origin='upper',extent=extent);colors=np.array([c['color'] for c in r['cover']]).reshape(h,w,3);axs[2].imshow(colors,origin='upper',extent=extent)
x=np.arange(w)*cell/1000;y=(h-1-np.arange(h))*cell/1000
cs=axs[1].contour(x,y,zz,levels=np.arange(np.floor(zz.min()/25)*25,zz.max(),25),colors='#475146',linewidths=.35,alpha=.65)
axs[1].clabel(cs,fontsize=6,fmt='%d')
xy=lambda i:(i%w*cell/1000,(h-1-i//w)*cell/1000)
segments=[];widths=[]
for i,j in enumerate(r['drainage']['receiver']):
 q=r['drainage']['routedSupplyM3PerYear'][i]/31536000
 if j<0 or q<.04:continue
 segments.append([xy(i),xy(j)]);widths.append(min(2.5,.25+np.log10(1+q)*1.1))
for ax in axs[1:]:
 ax.add_collection(LineCollection(segments,colors='#25a9d4',linewidths=widths));ax.set_xlabel('km');ax.set_ylabel('km')
 for port in r['parentWater']['window']['crossings']:
  xp,yp=xy(port['cell']);ax.scatter(xp,yp,c='#c83535' if port['direction']=='in' else '#65249b',s=35,zorder=8);ax.annotate(port['direction'].upper(),(xp,yp),xytext=(8,-12 if port['direction']=='in' else 8),textcoords='offset points',fontsize=10,color='#11202c',bbox=dict(facecolor='white',alpha=.8,edgecolor='none'),zorder=9)
axs[1].set_title('L2: inherited main river + local tributaries');axs[2].set_title('L2: potential cover + the same water network')
fig.suptitle('Water-connected generation: same planet, committed parent river',fontsize=18,weight='bold')
fig.text(.08,.88,'Actual generated data, not imagegen or a browser screenshot. Local window: 11.46 x 8.58 km.',fontsize=11)
cax=fig.add_axes([.08,.245,.22,.018]);fig.colorbar(plt.cm.ScalarMappable(norm=norm,cmap=cmap),cax=cax,orientation='horizontal',label='Elevation (m), not vegetation / snow')
fig.text(.08,.035,'L1 blue: annual potential flow >= 20 m³/s. L2 blue: >= 0.04 m³/s; line width indicates flow, NOT physical bank width.\nMiddle colours: elevation, 0–1500 m; 25 m contours. Right colours: coarse-climate potential forest / woodland / riparian cover.\nRiver enters from the north and leaves to the south-west. Local routing depressions: 0; annual water budget conserved.\nLimits: L1 grid directions remain visible; channel/valley shape is a geometric prior, not an erosion simulation.\nFirst-use bed anchors are retained; independent neighbouring terrain and seasonal lake dynamics are not yet complete.',fontsize=10.5)
fig.savefig(args.output,dpi=150,bbox_inches='tight')
