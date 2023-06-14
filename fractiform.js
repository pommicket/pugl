'use strict';

let gl;
let program_main;
let program_post;
let vertex_buffer_rect;
let canvas;
let framebuffer;
let framebuffer_color_texture;
let sampler_texture;
let width = 1920, height = 1920;

window.addEventListener('load', startup);

function handle_key_press(e) {
	let code = e.keyCode;
	switch (code) {
	case 32:
		perform_step();
	}
}

function startup() {
	canvas = document.getElementById('canvas');
	window.addEventListener('keydown', handle_key_press);
	
	gl = canvas.getContext('webgl');
	if (gl === null) {
		show_error('your browser doesnt support webgl.\noh well.');
		return;
	}
	
	program_main = compile_program('main', `
attribute vec2 v_pos;
uniform vec2 u_scale;
uniform vec2 u_offset;
varying vec2 uv;
void main() {
	uv = v_pos * 0.5 + 0.5;
	gl_Position = vec4(v_pos * u_scale + u_offset, 0.0, 1.0);
}
`, `
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D u_texture;
uniform vec4 u_color;
uniform float u_color_mix;
varying vec2 uv;

void main() {
	gl_FragColor = mix(texture2D(u_texture, uv), u_color, u_color_mix);
}
`);
	if (program_main === null) {
		return;
	}
	
	program_post = compile_program('main', `
attribute vec2 v_pos;
varying vec2 uv;
void main() {
	uv = v_pos * 0.5 + 0.5;
	gl_Position = vec4(v_pos, 0.0, 1.0);
}
`, `
#ifdef GL_ES
precision highp float;
#endif
uniform sampler2D u_texture;
varying vec2 uv;
void main() {
	gl_FragColor = texture2D(u_texture, uv);
}
`);
	if (program_post === null) {
		return;
	}
	
	vertex_buffer_rect = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_rect);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
		-1.0, -1.0, 1.0, -1.0, 1.0, 1.0,
		-1.0, -1.0, 1.0, 1.0, -1.0, 1.0
	]), gl.STATIC_DRAW);
	
	framebuffer_color_texture = gl.createTexture();
	sampler_texture = gl.createTexture();
	
	set_up_framebuffer();
	
	frame(0.0);
}

function frame(time) {
	time *= 1e-3;
	
	let canvas_width = canvas.offsetWidth;
	let canvas_height = canvas.offsetHeight;
	canvas.width = canvas_width;
	canvas.height = canvas_height;
	
	let step = true;
	
	if (step) {
		perform_step();
	}
	
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.viewport(0, 0, canvas_width, canvas_height);
	gl.clearColor(0.0, 0.0, 0.0, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	
	let aspect_ratio = width / height;
	if (canvas_width / aspect_ratio < canvas_height) {
		// landscape mode
		let viewport_height = Math.floor(canvas_width / aspect_ratio);
		gl.viewport(0, Math.floor((canvas_height - viewport_height) * 0.5), canvas_width, viewport_height);
	} else {
		// portrait mode
		let viewport_width = Math.floor(canvas_height * aspect_ratio);
		gl.viewport(Math.floor((canvas_width - viewport_width) * 0.5), 0, viewport_width, canvas_height);
	}
	
	gl.useProgram(program_post);
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
	gl.clearColor(0.5, 0.0, 0.5, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	
	gl.useProgram(program_main);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, sampler_texture);
	gl.uniform4fv(gl.getUniformLocation(program_main, 'u_color'), [1.0, 1.0, 1.0, 1.0]);
	gl.uniform1f(gl.getUniformLocation(program_main, 'u_color_mix'), 0.1);
	gl.uniform1i(gl.getUniformLocation(program_main, 'u_sampler_texture'), 0);
	
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_rect);
	let v_pos = gl.getAttribLocation(program_main, 'v_pos');
	gl.enableVertexAttribArray(v_pos);
	gl.vertexAttribPointer(v_pos, 2, gl.FLOAT, false, 0, 0);
	
	for (let y = 0; y < 3; ++y) {
		for (let x = 0; x < 3; ++x) {
			let k = 1.0 / 3.0;
			if (x == 1 && y == 1) {
				continue;
			}
			gl.uniform2fv(gl.getUniformLocation(program_main, 'u_scale'), [k, k]);
			gl.uniform2fv(gl.getUniformLocation(program_main, 'u_offset'), [x * 2.0 / 3.0 - 2.0 / 3.0, y * 2.0 / 3.0 - 2.0 / 3.0]);
			gl.drawArrays(gl.TRIANGLES, 0, 6);
		}
	}
	
	gl.bindTexture(gl.TEXTURE_2D, sampler_texture);
	gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, width, height, 0);
}
	
function compile_program(name, vertex_source, fragment_source) {
	let vshader = compile_shader(name + ' (vertex)', gl.VERTEX_SHADER, vertex_source);
	let fshader = compile_shader(name + ' (fragment)', gl.FRAGMENT_SHADER, fragment_source);
	if (vshader === null || fshader === null) {
		return null;
	}
	let program = gl.createProgram();
	gl.attachShader(program, vshader);
	gl.attachShader(program, fshader);
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
	sampler_pixels.fill(255);
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
