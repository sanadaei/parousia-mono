"""Offline decoder/manifest safety checks; not geological acceptance."""
import importlib.util,pathlib,tempfile,unittest
import numpy as np
spec=importlib.util.spec_from_file_location('gsi_inspect',pathlib.Path(__file__).with_name('inspect-gsi-reference.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class GsiTests(unittest.TestCase):
 def test_signed_centimetres_and_missing(self):
  a=np.zeros((256,256,3),dtype=np.uint8)
  for i,v in enumerate([0,12345,2**24-250,2**23,2**23-1]):a[0,i]=[v>>16,(v>>8)&255,v&255]
  h=m.decode_elevation(a)
  self.assertEqual(h[0,0],0);self.assertEqual(h[0,1],123.45);self.assertEqual(h[0,2],-2.5);self.assertTrue(np.isnan(h[0,3]));self.assertEqual(h[0,4],83886.07)
 def test_rejects_shape_and_type(self):
  for a in [np.zeros((256,256,4),dtype=np.uint8),np.zeros((255,256,3),dtype=np.uint8),np.zeros((256,256,3))]:
   with self.assertRaises(ValueError):m.decode_elevation(a)
 def test_missing_tiles_do_not_become_water(self):
  site={'shape':[768,768],'zoom':15,'centreTile':[1,1],'centre':[35,140],'tiles':[{'url':f'https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/15/{x}/{y}.png','status':404} for y in range(3) for x in range(3)]}
  with tempfile.TemporaryDirectory() as p:
   with self.assertRaisesRegex(ValueError,'No usable'):m.inspect_site(site,pathlib.Path(p))
if __name__=='__main__':unittest.main()
