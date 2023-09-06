public-target: guide-target
	rm -rf public
	mkdir public
	cp -r guide public
	cp index.html icon.png style.css pugl.js move.svg x.svg favicon.ico public/

guide-target:
	python3 guide-src/make.py

deploy: public-target
	@[ `git diff HEAD | wc -c` = 0 ] || { echo 'there are uncommitted changes; please commit them first'; exit 1; }
	rclone --s3-acl=public-read --transfers 16 --checkers 16 -P sync public/ linode://s.pommicket.com/pugl/
