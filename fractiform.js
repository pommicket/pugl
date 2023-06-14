'use strict';

let gl;
let program_main;
let program_post;
let vertex_buffer_rect;
let canvas;
let framebuffer;
let framebuffer_color_texture;
let prev_width = -1, prev_height = -1;

window.addEventListener('load', startup);

function startup() {
	canvas = document.getElementById('canvas');
	gl = canvas.getContext('webgl');
	
	program_main = compile_program('main', `
attribute vec2 v_pos;
uniform vec2 u_scale;
void main() {
	gl_Position = vec4(v_pos * u_scale, 0.0, 1.0);
}
`, `
#ifdef GL_ES
precision highp float;
#endif

uniform vec4 u_color;

void main() {
	gl_FragColor = u_color;
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
	
	
	frame(0.0);
}

function frame(time) {
	time *= 1e-3;
	
	let width = canvas.offsetWidth;
	let height = canvas.offsetHeight;
	canvas.width = width;
	canvas.height = height;
	
	if (width !== prev_width || height !== prev_height) {
		console.log('new framebuffer');
		prev_width = width;
		prev_height = height;
		framebuffer = gl.createFramebuffer();
		framebuffer_color_texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, framebuffer_color_texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
			gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, framebuffer_color_texture, 0);
		let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		if (status !== gl.FRAMEBUFFER_COMPLETE) {
			show_error('Error: framebuffer incomplete (status ' + status + ')');
			return;
		}
	}
	
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.viewport(0, 0, width, height);
	gl.clearColor(Math.sin(time) ** 2, 0.9, 1.0, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	
	gl.useProgram(program_main);
	
	gl.uniform4fv(gl.getUniformLocation(program_main, 'u_color'), [0.1, 0.7, 0.2, 1.0]);
	gl.uniform2fv(gl.getUniformLocation(program_main, 'u_scale'), [0.5, 0.5]);
	
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_rect);
	
	let v_pos = gl.getAttribLocation(program_main, 'v_pos');
	gl.enableVertexAttribArray(v_pos);
	gl.vertexAttribPointer(v_pos, 2, gl.FLOAT, false, 0, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
	
	gl.useProgram(program_post);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, framebuffer_color_texture);
	gl.uniform1i(gl.getUniformLocation(program_post, 'u_texture'), 0);
	v_pos = gl.getAttribLocation(program_post, 'v_pos');
	gl.enableVertexAttribArray(v_pos);
	gl.vertexAttribPointer(v_pos, 2, gl.FLOAT, false, 0, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
	
	requestAnimationFrame(frame);
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
