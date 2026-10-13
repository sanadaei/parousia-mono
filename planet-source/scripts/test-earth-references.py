"""Offline tests for the optional standard-library Earth data downloader."""
import hashlib, importlib.util, io, pathlib, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('earth_fetch',pathlib.Path(__file__).with_name('fetch-earth-references.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class DownloadTests(unittest.TestCase):
 def entry(self,data=b'example'):
  return dict(url='https://gisstar.gsi.go.jp/terrain2021/test.zip',bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
 def test_download_and_verified_cache(self):
  with tempfile.TemporaryDirectory() as p:
   root=pathlib.Path(p)
   with patch.object(module.urllib.request,'urlopen',return_value=io.BytesIO(b'example')) as request:
    self.assertEqual(module.fetch_reference(self.entry(),root,100)['status'],'downloaded-and-verified');self.assertEqual(module.fetch_reference(self.entry(),root,100)['status'],'verified-cache');self.assertEqual(request.call_count,1)
 def test_gsi_png_source_and_explicit_filename(self):
  with tempfile.TemporaryDirectory() as p,patch.object(module.urllib.request,'urlopen',return_value=io.BytesIO(b'example')):
   entry={**self.entry(), 'url':'https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/15/1/2.png','file':'site-15-1-2.png'}
   self.assertEqual(module.fetch_reference(entry,pathlib.Path(p),100)['status'],'downloaded-and-verified')
 def test_bad_digest_does_not_publish_file(self):
  with tempfile.TemporaryDirectory() as p,patch.object(module.urllib.request,'urlopen',return_value=io.BytesIO(b'wrong')):
   root=pathlib.Path(p)
   with self.assertRaises(ValueError):module.fetch_reference(self.entry(),root,100)
   self.assertFalse((root/'test.zip').exists());self.assertTrue((root/'test.zip.part').exists())
 def test_reject_sources_paths_and_large_responses(self):
  with tempfile.TemporaryDirectory() as p:
   root=pathlib.Path(p)
   for changes in [dict(url='http://gisstar.gsi.go.jp/test'),dict(url='https://example.org/test'),dict(file='../escape')]:
    with self.assertRaises(ValueError):module.fetch_reference({**self.entry(),**changes},root,100)
   with patch.object(module.urllib.request,'urlopen',return_value=io.BytesIO(b'example')):
    with self.assertRaises(ValueError):module.fetch_reference(self.entry(),root,3)
 def test_existing_different_file_is_preserved(self):
  with tempfile.TemporaryDirectory() as p:
   root=pathlib.Path(p);target=root/'test.zip';target.write_bytes(b'user data')
   with self.assertRaises(ValueError):module.fetch_reference(self.entry(),root,100)
   self.assertEqual(target.read_bytes(),b'user data')
if __name__=='__main__':unittest.main()
