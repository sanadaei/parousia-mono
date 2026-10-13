# Actual generated intermediate data and inherited views; no image synthesis.
import argparse,json,numpy as np,matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.colors import LinearSegmentedColormap,Normalize
from matplotlib.patches import Rectangle
p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');a=p.parse_args();r=json.load(open(a.input));c=r['context'];g=c['grid']
fig=plt.figure(figsize=(14,11));gs=fig.add_gridspec(2,2,width_ratios=[1.15,1],hspace=.22,wspace=.2);whole=fig.add_subplot(gs[:,0]);axes=[fig.add_subplot(gs[0,1]),fig.add_subplot(gs[1,1])]
cmap=LinearSegmentedColormap.from_list('ground',['#8da77e','#c1b987','#ac9373','#dfd8ca']);norm=Normalize(min(c['elevation']),max(c['elevation']))
W=(g['columns']-1)*g['cellSizeM'];H=(g['rows']-1)*g['cellSizeYM']
whole.imshow(np.array(c['elevation']).reshape(g['rows'],g['columns']),extent=[0,W/1000,H/1000,0],cmap=cmap,norm=norm)
segments=[]
for i,j in enumerate(c['receiver']):
 if j>=0 and c['annualFlowM3'][i]>=5e6:segments.append([(i%g['columns']*g['cellSizeM']/1000,i//g['columns']*g['cellSizeYM']/1000),(j%g['columns']*g['cellSizeM']/1000,j//g['columns']*g['cellSizeYM']/1000)])
whole.add_collection(LineCollection(segments,colors='#2385ab',linewidths=1))
whole.set_title(f"Shared intermediate context\n{W/1000:.0f} x {H/1000:.0f} km / {g['cellSizeM']/1000:.2f} km source spacing")
for k,(v,ax) in enumerate(zip(r['windows'],axes)):
 s=v['settings'];x=s['x0M']/1000;y=s['y0M']/1000;w=s['widthM']/1000;h=s['heightM']/1000
 whole.add_patch(Rectangle((x,y),w,h,fill=False,edgecolor='#c44e31',lw=1.8));whole.text(x+w+.8,y+h/2,chr(65+k),color='#a33425',weight='bold')
 z=np.array(v['elevation']).reshape(v['grid']['rows'],v['grid']['columns']);ax.imshow(z,extent=[x,x+w,y+h,y],cmap=cmap,norm=norm)
 xx=np.linspace(x,x+w,v['grid']['columns']);yy=np.linspace(y,y+h,v['grid']['rows']);ax.contour(xx,yy,z,levels=np.arange(np.floor(z.min()/20)*20,z.max()+20,20),colors='#615b47',linewidths=.4,alpha=.5)
 lines=[];widths=[]
 for e in v['reaches']:
  if e['annualFlowM3']<5e5:continue
  lines.append([(e['start']['xM']/1000,e['start']['yM']/1000),(e['end']['xM']/1000,e['end']['yM']/1000)]);widths.append(1.8 if e['annualFlowM3']>=5e6 else .6)
 ax.add_collection(LineCollection(lines,colors='#167fa6',linewidths=widths))
 seam=y+h if k==0 else y;ax.axhline(seam,color='#bd4a31',ls='--',lw=1.2)
 ports=[p for p in v['ports'] if ('south' if k==0 else 'north') in p['boundarySides']]
 ax.scatter([p['xM']/1000 for p in ports],[p['yM']/1000 for p in ports],color='#bd4a31',s=13,zorder=6,clip_on=False)
 ax.set_title(f"Window {chr(65+k)}: 20 x 20 km / 250 m display samples",fontsize=11);ax.set_xlabel('km east');ax.set_ylabel('km south')
whole.set_xlabel('km east');whole.set_ylabel('km south')
fig.suptitle('Intermediate water inherited by neighbouring finer views',fontsize=17,weight='bold',y=.96)
fig.subplots_adjust(bottom=.20,top=.89)
cax=fig.add_axes([.2,.125,.6,.018]);fig.colorbar(plt.cm.ScalarMappable(norm=norm,cmap=cmap),cax=cax,orientation='horizontal',label='Elevation (m); not vegetation or snow')
fig.text(.08,.028,'Shared red boundary: 16 matching water crossings; identical ground samples and inherited annual flow.\nSaved windows reload unchanged. Finer viewing resolution does not regenerate channels.\n250 m samples interpolate the intermediate surface. No new tributaries, channel banks or fine riverbed are generated here.\nWhole-context outlets remain unresolved survey exits. Offline data rendering, not browser QA.',fontsize=10)
fig.savefig(a.output,dpi=140,bbox_inches='tight')
