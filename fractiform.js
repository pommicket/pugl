'use strict';

/*
TODO:
- draw lines btwn vertex positions and uvs
- synthlike interface? (change name to fraxynth?)
- grid
*/

let gl;
let program_main;
let program_post;
let vertex_buffer_rect;
let vertex_buffer_main;
let vertex_data_main;
let page;
let canvas;
let ui_canvas;
let ui_ctx;
let framebuffer;
let framebuffer_color_texture;
let sampler_texture;
let current_time;
let ui_shown = true;
let ui_div;
let viewport_width, viewport_height;
let shift_key = false, ctrl_key = false;

let width = 1920, height = 1920;

window.addEventListener('load', startup);

function set_ui_shown(to) {
	ui_shown = to;
	ui_div.style.visibility = to ? 'visible' : 'collapse';
	page.dataset.uiShown = to ? '1' : '0';
}

function rgba_hex_to_float(hex) {
	let color = {
		r: parseInt(hex.substr(1, 2), 16) / 255,
		g: parseInt(hex.substr(3, 2), 16) / 255,
		b: parseInt(hex.substr(5, 2), 16) / 255,
		a: hex.length <= 7 ? 1 : parseInt(hex.substr(7, 2), 16) / 255,
	};
	Object.preventExtensions(color);
	return color;
}

function rgba_float_to_hex(flt) {
	function comp(x) {
		x = Math.round(x * 255);
		if (x < 0) x = 0;
		if (x > 255) x = 255;
		let s = x.toString(16);
		while (s.length < 2) {
			s = '0' + s;
		}
		return s;
	}
	return '#' + comp(flt.r) + comp(flt.g) + comp(flt.b) + comp(flt.a);
}

function update_key_modifiers_from_event(e) {
	shift_key = e.shiftKey;
	ctrl_key = e.ctrlKey;
}

function on_key_press(e) {
	update_key_modifiers_from_event(e);
	let code = e.keyCode;
	if (e.target.tagName === 'INPUT') {
		return;
	}
	
	switch (code) {
	case 32: // space
		if (canvas_is_target)
			perform_step();
		break;
	case 9: // tab
		set_ui_shown(!ui_shown);
		e.preventDefault();
		break;
	}
}

function on_key_release(e) {
	update_key_modifiers_from_event(e);
}


function on_mouse_move(e) {
	update_key_modifiers_from_event(e);
}

function distance(p0, p1) {
	let dx = p0.x - p1.x;
	let dy = p0.y - p1.y;
	return Math.sqrt(dx * dx + dy * dy);
}

function on_click(e) {
	update_key_modifiers_from_event(e);
	if (!ui_shown) {
		return;
	}
}

function startup() {
	page = document.getElementById('page');
	canvas = document.getElementById('canvas');
	ui_div = document.getElementById('ui');
	
	gl = canvas.getContext('webgl');
	if (gl === null) {
		// support for very-old-but-not-ancient browsers
		gl = canvas.getContext('experimental-webgl');
		if (gl === null) {
			show_error('your browser doesnt support webgl.\noh well.');
			return;
		}
	}
	
	program_main = compile_program('main', ['main-vertex-shader', 'main-fragment-shader']);
	if (program_main === null) {
		return;
	}
	
	program_post = compile_program('post', ['post-vertex-shader', 'post-fragment-shader']);
	if (program_post === null) {
		return;
	}
	
	vertex_buffer_rect = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_rect);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
		-1.0, -1.0, 1.0, -1.0, 1.0, 1.0,
		-1.0, -1.0, 1.0, 1.0, -1.0, 1.0
	]), gl.STATIC_DRAW);
	
	vertex_buffer_main = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_main);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
		-1.0, -1.0, 1.0, -1.0, 1.0, 1.0,
		-1.0, -1.0, 1.0, 1.0, -1.0, 1.0
	]), gl.STATIC_DRAW);
	
	framebuffer_color_texture = gl.createTexture();
	sampler_texture = gl.createTexture();
	
	set_up_framebuffer();
	
	frame(0.0);
	window.addEventListener('keydown', on_key_press);
	window.addEventListener('keyup', on_key_release);
	window.addEventListener('mousemove', on_mouse_move);
	window.addEventListener('click', on_click);
}

function frame(time) {
	current_time = time * 1e-3;
	
	let page_width = page.offsetWidth;
	let page_height = page.offsetHeight;	
	
	let aspect_ratio = width / height;
	let canvas_x = 0, canvas_y = 0;
	if (page_width / aspect_ratio < page_height) {
		// landscape mode
		canvas_y = Math.floor((page_height - viewport_height) * 0.5);
		viewport_width = page_width;
		viewport_height = Math.floor(page_width / aspect_ratio);
	} else {
		// portrait mode
		canvas_x = Math.floor((page_width - viewport_width) * 0.5);
		viewport_width = Math.floor(page_height * aspect_ratio);
		viewport_height = page_height;
	}
	
	canvas.width = viewport_width;
	canvas.height = viewport_height;
	canvas.style.left = canvas_x + 'px';
	canvas.style.top = canvas_y + 'px';
	
	let step = true;
	if (step) {
		perform_step();
	}
	
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.viewport(0, 0, viewport_width, viewport_height);
	gl.clearColor(0.0, 0.0, 0.0, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	
	gl.useProgram(program_post);
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_rect);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, sampler_texture);
	gl.uniform1i(gl.getUniformLocation(program_post, 'u_texture'), 0);
	let v_pos = gl.getAttribLocation(program_post, 'v_pos');
	gl.enableVertexAttribArray(v_pos);
	gl.vertexAttribPointer(v_pos, 2, gl.FLOAT, false, 0, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
	
	if (requestAnimationFrame == null) {
		show_error('your browser doesnt support requestAnimationFrame.\noh well.');
		return;
	}
	requestAnimationFrame(frame);
}

function perform_step() {
	if (width === -1) {
		// not properly loaded yet
		return;
	}
	
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.viewport(0, 0, width, height);
	gl.clearColor(0.0, 0.0, 0.0, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	
	gl.useProgram(program_main);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, sampler_texture);
	gl.uniform1i(gl.getUniformLocation(program_main, 'u_texture'), 0);
	gl.uniform1f(gl.getUniformLocation(program_main, 'u_time'), current_time % 3600);
	
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_main);
	let v_pos = gl.getAttribLocation(program_main, 'v_pos');
	gl.enableVertexAttribArray(v_pos);
	gl.vertexAttribPointer(v_pos, 2, gl.FLOAT, false, 8, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
	
	gl.bindTexture(gl.TEXTURE_2D, sampler_texture);
	gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, width, height, 0);
}
	
function compile_program(name, shaders) {
	let program = gl.createProgram();
	for (let i = 0; i < shaders.length; i++) {
		let shader_element = document.getElementById(shaders[i]);
		let source = shader_element.firstChild.nodeValue;
		let type = shader_element.getAttribute('type');
		let gl_type;
		if (type === 'x-shader/x-vertex') {
			gl_type = gl.VERTEX_SHADER;
		} else if (type === 'x-shader/x-fragment') {
			gl_type = gl.FRAGMENT_SHADER;
		} else {
			show_error('unrecognized shader type: ' + type);
		}
		let shader = compile_shader(name + ' ' + type, gl_type, source);
		gl.attachShader(program, shader);
	}
	
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		show_error('Error linking shader program:\n' + gl.getProgramInfoLog(program));
		return null;
	}
	return program;
}

function set_up_framebuffer() {
	framebuffer = gl.createFramebuffer();
	let sampler_pixels = new Uint8Array(width * height * 4);
	sampler_pixels.fill(0);
	set_up_rgba_texture(sampler_texture, width, height, sampler_pixels);
	set_up_rgba_texture(framebuffer_color_texture, width, height, null);
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, framebuffer_color_texture, 0);
	let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		show_error('Error: framebuffer incomplete (status ' + status + ')');
		return;
	}
}

function set_up_rgba_texture(texture, width, height, pixels) {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
		gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function compile_shader(name, type, source) {
	let shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		show_error('Error compiling shader ' + name + ':\n' +
			gl.getShaderInfoLog(shader));
		return null;
	}
	return shader;
}

function show_error(error) {
	document.getElementById('error-message').innerText = error;
	document.getElementById('error-dialog').showModal();
}
