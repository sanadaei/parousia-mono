"""Identical inherited comparison diagnostic, isolated from generator routing."""
import math,heapq
import numpy as np
def drainage(z,dx,dy):
 h,w=z.shape;n=z.size;filled=z.copy().ravel();seen=np.zeros(n,bool);parent=np.full(n,-1,int);heap=[]
 dirs=[(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
 for y in range(h):
  for x in range(w):
   if y in (0,h-1) or x in (0,w-1):
    i=y*w+x;seen[i]=True;heapq.heappush(heap,(filled[i],i))
 while heap:
  v,i=heapq.heappop(heap);y,x=divmod(i,w)
  for oy,ox in dirs:
   yy,xx=y+oy,x+ox
   if 0<=yy<h and 0<=xx<w:
    j=yy*w+xx
    if not seen[j]:
     seen[j]=True;parent[j]=i;filled[j]=max(v,filled[j]);heapq.heappush(heap,(filled[j],j))
 rec=parent.copy()
 for y in range(1,h-1):
  for x in range(1,w-1):
   i=y*w+x;best=0
   for oy,ox in dirs:
    j=(y+oy)*w+x+ox;s=(filled[i]-filled[j])/math.hypot(ox*dx,oy*dy)
    if s>best:best=s;rec[i]=j
 weight=np.ones((h,w));weight[[0,-1],:]*=.5;weight[:,[0,-1]]*=.5
 area=weight.ravel()*dx*dy/1e6;ind=np.bincount(rec[rec>=0],minlength=n);queue=list(np.where(ind==0)[0]);count=0
 while queue:
  i=queue.pop();count+=1;j=rec[i]
  if j>=0:
   area[j]+=area[i];ind[j]-=1
   if ind[j]==0:queue.append(j)
 assert count==n
 assert abs(area[rec<0].sum()-dx*dy*(w-1)*(h-1)/1e6)<1e-7
 return rec,area,filled-z.ravel()

def stats(a,dx,dy):
 gy,gx=np.gradient(a,dy,dx);slope=np.degrees(np.arctan(np.hypot(gx,gy)));rec,area,fill=drainage(a,dx,dy)
 interior=a[1:-1,1:-1]; lower=np.zeros(interior.shape,bool)
 for oy,ox in [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]:
  lower |= a[1+oy:a.shape[0]-1+oy,1+ox:a.shape[1]-1+ox] < interior
 return dict(rawDirectD8InteriorNoLowerNeighborFraction=float(np.mean(~lower)), boundaryCondition='all perimeter nodes open; no inherited outlets or imports',minM=float(a.min()),maxM=float(a.max()),reliefM=float(np.ptp(a)),elevationP05P50P95M=np.percentile(a,[5,50,95]).tolist(),slopeP50P95Degrees=np.percentile(slope,[50,95]).tolist(),fillMaxM=float(fill.max()),fillP95M=float(np.percentile(fill,95)),fillPositiveFraction=float(np.mean(fill>1e-8)),outletAreaSumKm2=float(area[rec<0].sum()),maxContributingAreaKm2=float(area.max())),slope,rec,area
