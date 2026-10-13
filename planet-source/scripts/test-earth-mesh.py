import importlib.util, unittest
from pathlib import Path
import numpy as np
spec=importlib.util.spec_from_file_location('earth_mesh',Path(__file__).parent/'experiments/import-earth-reference-mesh.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class EarthMeshTests(unittest.TestCase):
 def test_plane_and_orientation(self):
  y,x=np.mgrid[0:5,0:5];h=x+2*y;m,z,d=module.reference_mesh(h,2,2)
  self.assertEqual(len(m['points']),9);self.assertEqual(len(m['triangles']),8)
  for t in m['triangles']:
   a,b,c=[m['points'][i] for i in t];self.assertGreater((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),0)
  self.assertEqual(z[0],0);self.assertEqual(z[-1],12)
 def test_missing_in_skipped_support_omits_cell(self):
  h=np.zeros((5,5));h[1,1]=np.nan;m,z,d=module.reference_mesh(h,1,2)
  self.assertEqual(len(m['triangles']),6);self.assertEqual(d['sampledNoDataCells'],0)
  self.assertEqual(d['sourceNoDataCells'],1)
  self.assertFalse(any(all(m['points'][i][0]<=2 and m['points'][i][1]>=2 for i in t) for t in m['triangles']))
 def test_no_data_is_not_a_flat_surface(self):
  with self.assertRaisesRegex(ValueError,'No fully observed'):module.reference_mesh(np.full((5,5),np.nan),1,2)
 def test_bounded_grid(self):
  with self.assertRaisesRegex(ValueError,'65536'):module.reference_mesh(np.zeros((257,257)),1,1)
 def test_parameters_and_ownership(self):
  h=np.zeros((5,5));before=h.copy();m,z,d=module.reference_mesh(h,1,1);np.testing.assert_equal(h,before)
  for spacing,stride in [(0,1),(1,0),(1,1.5)]:
   with self.assertRaises(ValueError):module.reference_mesh(h,spacing,stride)
if __name__=='__main__':unittest.main()
