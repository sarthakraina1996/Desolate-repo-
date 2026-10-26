# Builds the combined HRMS + Projects demo page into demo/suite/dist:
#   python3 demo/suite/build.py <path to BrainADZ Projects checkout>
# Run `npm run build:demo` here and `npm run build:demo` in the Projects checkout first.
# Publish dist/index.html with hrms.html and projects.html next to it.
import os, shutil, sys

here = os.path.dirname(os.path.abspath(__file__))
projects = sys.argv[1]
out = os.path.join(here, 'dist')
os.makedirs(out, exist_ok=True)
shutil.copy(os.path.join(here, 'index.html'), out)
shutil.copy(os.path.join(here, '..', 'dist', 'BrainADZ-HRMS.html'), os.path.join(out, 'hrms.html'))
# The Projects demo, with the suite script first in its <head>.
html = open(os.path.join(projects, 'dist-demo', 'standalone.html')).read()
head = open(os.path.join(here, 'projects-head.js')).read()
assert html.count('<head>') == 1
with open(os.path.join(out, 'projects.html'), 'w') as f:
    f.write(html.replace('<head>', '<head><script>\n' + head + '</script>', 1))
print('Built', out)
