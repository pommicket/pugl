public-target: guide-target
	rm -rf public
	mkdir public
	cp -r guide public
	cp index.html style.css pugl.js move.svg x.svg favicon.ico public/

guide-target:
	python3 guide-src/make.py
