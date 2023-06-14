'use strict';

let gl;
let program_main;
let program_post;
let vertex_buffer_rect;
let vertex_buffer_main;
let vertex_data_main;
let canvas;
let framebuffer;
let framebuffer_color_texture;
let sampler_texture;
let current_time;
let vertices_main = [];

let width = 1920, height = 1920;

window.addEventListener('load', startup);

function handle_key_press(e) {
	let code = e.keyCode;
	switch (code) {
	case 32:
		perform_step();
	}
}

function lerp(a, b, x) {
	return a + (b - a) * x;
}

function vertices_push_quad(vertices, v0, v1, v2, v3) {
	vertices.push(v0);
	vertices.push(v1);
	vertices.push(v2);
	vertices.push(v0);
	vertices.push(v2);
	vertices.push(v3);
}

const VERTEX_POS = 0;
const VERTEX_UV = 8;
const VERTEX_COLOR = 16;
const VERTEX_SIZE = 32;

function vertices_to_uint8_array(vertices) {
	let array = new Uint8Array(vertices.length * VERTEX_SIZE);
	for (var i = 0; i < vertices.length; i++) {
		let vertex = vertices[i];
		array.set(new Uint8Array((new Float32Array(vertex.pos)).buffer),
			VERTEX_SIZE * i + VERTEX_POS);
		array.set(new Uint8Array((new Float32Array(vertex.uv)).buffer),
			VERTEX_SIZE * i + VERTEX_UV);
		array.set(new Uint8Array((new Float32Array(vertex.color)).buffer),
			VERTEX_SIZE * i + VERTEX_COLOR);
	}
	return array;
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
attribute vec2 v_uv;
attribute vec4 v_color;
varying vec2 uv;
varying vec4 color;
void main() {
	uv = v_uv;
	color = v_color;
	gl_Position = vec4(v_pos, 0.0, 1.0);
}
`, `
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D u_texture;
varying vec4 color;
varying vec2 uv;

void main() {
	gl_FragColor = mix(texture2D(u_texture, uv), vec4(color.xyz, 1.0), color.w);
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
	
	vertex_buffer_main = gl.createBuffer();
	
	for (let y = 0; y < 3; ++y) {
		for (let x = 0; x < 3; ++x) {
			if (x == 1 && y == 1) continue;
			let k = 2.0 / 3.0;
			let x0 = x * 2.0 / 3.0 - 1.0;
			let y0 = y * 2.0 / 3.0 - 1.0;
			let x1 = x0 + k;
			let y1 = y0 + k;
			let color = [1.0, 0.5, 1.0, 0.1];
			vertices_push_quad(vertices_main,
				{pos: [x0, y0], uv: [0.0, 0.0], color: color},
				{pos: [x1, y0], uv: [1.0, 0.0], color: color},
				{pos: [x1, y1], uv: [1.0, 1.0], color: color},
				{pos: [x0, y1], uv: [0.0, 1.0], color: color},
			);
			
		}
	}
	{
		let k = 0.5 / 3.0;
		let color = [0.5, 0.5, 1.0, 1.0];
		vertices_push_quad(vertices_main,
			{pos: [-k, -k], uv: [0.0, 0.0], color: color},
			{pos: [k,  -k], uv: [1.0, 0.0], color: color},
			{pos: [k,   k], uv: [1.0, 1.0], color: color},
			{pos: [-k,  k], uv: [0.0, 1.0], color: color},
		);
	}
	
	let vertex_data = vertices_to_uint8_array(vertices_main);
	console.log(new Float32Array(vertex_data.buffer));
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_main);
	gl.bufferData(gl.ARRAY_BUFFER, vertex_data, gl.DYNAMIC_DRAW);
	
	framebuffer_color_texture = gl.createTexture();
	sampler_texture = gl.createTexture();
	
	set_up_framebuffer();
	
	frame(0.0);
}

function frame(time) {
	current_time = time * 1e-3;
	
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
	gl.uniform4fv(gl.getUniformLocation(program_main, 'u_color'), [1.0, 1.0, 1.0, 1.0]);
	gl.uniform1i(gl.getUniformLocation(program_main, 'u_sampler_texture'), 0);
	
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_main);
	let v_pos = gl.getAttribLocation(program_main, 'v_pos');
	let v_uv = gl.getAttribLocation(program_main, 'v_uv');
	let v_color = gl.getAttribLocation(program_main, 'v_color');
	gl.enableVertexAttribArray(v_pos);
	gl.enableVertexAttribArray(v_uv);
	gl.enableVertexAttribArray(v_color);
	gl.vertexAttribPointer(v_pos,    2, gl.FLOAT, false, VERTEX_SIZE, VERTEX_POS);
	gl.vertexAttribPointer(v_uv,     2, gl.FLOAT, false, VERTEX_SIZE, VERTEX_UV);
	gl.vertexAttribPointer(v_color,  4, gl.FLOAT, false, VERTEX_SIZE, VERTEX_COLOR);
	gl.drawArrays(gl.TRIANGLES, 0, vertices_main.length);
	
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
