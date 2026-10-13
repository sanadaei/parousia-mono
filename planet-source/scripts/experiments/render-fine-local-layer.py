"""Render exact graph cut and its finer generated surface at the same physical scale."""
import json,sys,pathlib,numpy as np,matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.colors import LightSource
record=json.load(open(sys.argv[1]));output=sys.argv[2]
p=record['cut']['context'];q=record['context'];w=record['source']['widthM']/1000;h=record['source']['heightM']/1000
fig,axes=plt.subplots(1,3,figsize=(16,7),layout='constrained');lo=min(q['elevation']);hi=max(q['elevation'])
for ax,c,title in zip(axes[:2],[p,q],['Exact parent graph cut','Four factor-2 detail stages']):
 g=c['grid'];z=np.array(c['elevation']).reshape(g['rows'],g['columns']);shade=LightSource(315,45).shade(z,cmap=plt.colormaps['terrain'],vert_exag=2,dx=g['cellSizeM'],dy=g['cellSizeYM'],vmin=lo,vmax=hi)
 ax.imshow(shade,extent=[0,w,h,0]);lines=[];widths=[];threshold=max(c['annualFlowM3'])*.004
 for i,j in enumerate(c['receiver']):
  if j<0 or c['annualFlowM3'][i]<=0 or c['annualFlowM3'][i]<threshold:continue
  lines.append([(i%g['columns']*g['cellSizeM']/1000,i//g['columns']*g['cellSizeYM']/1000),(j%g['columns']*g['cellSizeM']/1000,j//g['columns']*g['cellSizeYM']/1000)])
  widths.append(.3+2*(c['annualFlowM3'][i]/max(c['annualFlowM3']))**.5)
 ax.add_collection(LineCollection(lines,colors='#1c55a5',linewidths=widths,alpha=.85))
 inlet=c['supplyOwnership']['inflows'];outlet=c['outlets']
 for vals,col,marker,label in [(inlet,'#00cfad','>','Imported edge flux'),(outlet,'#ee3853','s','Fixed outlet node')]:
  ax.scatter([v['cell']%g['columns']*g['cellSizeM']/1000 for v in vals],[v['cell']//g['columns']*g['cellSizeYM']/1000 for v in vals],c=col,marker=marker,s=34,edgecolors='black',linewidths=.4,label=label,zorder=5)
 ax.set_title(f"{title}\n{g['columns']}×{g['rows']} | {g['cellSizeM']:.1f}×{g['cellSizeYM']:.1f} m");ax.legend(loc='lower left',fontsize=8)
pg=p['grid'];qg=q['grid'];pz=np.array(p['elevation']).reshape(pg['rows'],pg['columns']);qz=np.array(q['elevation']).reshape(qg['rows'],qg['columns']);xx=np.linspace(0,pg['columns']-1,qg['columns']);yy=np.linspace(0,pg['rows']-1,qg['rows']);base=np.array([np.interp(xx,np.arange(pg['columns']),row) for row in pz]);base=np.array([np.interp(yy,np.arange(pg['rows']),base[:,x]) for x in range(qg['columns'])]).T
residual=qz-base;lim=max(abs(residual.min()),abs(residual.max()));im=axes[2].imshow(residual,extent=[0,w,h,0],cmap='RdBu_r',vmin=-lim,vmax=lim);fig.colorbar(im,ax=axes[2],label='Added elevation (m)',shrink=.7);axes[2].set_title('Added detail over parent interpolation\nExact inherited sample anchors retained')
for ax in axes:ax.set_xlabel('km');ax.set_ylabel('km');ax.set_aspect('equal');ax.set_xlim(0,w);ax.set_ylim(h,0)
report_path=pathlib.Path(sys.argv[1]).with_name('summary.json')
physical=json.load(open(report_path)).get('groundRouting') if report_path.exists() else None
physical_note=''
if physical:
 a,b=physical['parent'],physical['fine']
 physical_note=f"\nRouting correction max/P95: {a['maxRoutingCorrectionM']:.1f}/{a['p95RoutingCorrectionM']:.1f} → {b['maxRoutingCorrectionM']:.1f}/{b['p95RoutingCorrectionM']:.1f} m; imported-path uphill edges {a['importedFlowPaths']['uphillFraction']:.1%} → {b['importedFlowPaths']['uphillFraction']:.1%} (not physical rivers)"
fig.suptitle(f'Broad → local continuation | same {w:.2f} × {h:.2f} km extent | native 55 m generated source\n{len(record["cut"]["incoming"])} imported / {len(record["cut"]["outgoing"])} outgoing edges; no leave-and-reenter paths'+physical_note,fontsize=13)
footer='Adopted outside outlet amounts and nodes retained. Local detail shares the accepted upstream global linkage.' if record['status']=='adopted-boundary-preserving-detail' else 'Provisional downstream revisions; outside parent has not adopted the ledger. Global adoption remains incomplete.'
fig.text(.5,.005,footer+' Blue lines are routed potential flow, not hydraulic channels.',ha='center',fontsize=8)
fig.savefig(output,dpi=170);print(output)
