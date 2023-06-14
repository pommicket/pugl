'use strict';

let gl;
let program;
let vertex_buffer;
let prev_frame_time = 0.0;
let canvas;

window.addEventListener('load', startup);

function startup() {
	canvas = document.getElementById('canvas');
	gl = canvas.getContext('webgl');
	
	program = gl.createProgram();
	let vertex_shader = compile_shader('main vertex', gl.VERTEX_SHADER, `
attribute vec2 v_pos;
void main() {
	gl_Position = vec4(v_pos, 0.0, 1.0);
}
`);
	let fragment_shader = compile_shader('main fragment', gl.FRAGMENT_SHADER, `
#ifdef GL_ES
precision highp float;
#endif

uniform vec4 u_color;

void main() {
	gl_FragColor = u_color;
}
`);
	if (vertex_shader == null || fragment_shader == null) {
		return;
	}
	
	gl.attachShader(program, vertex_shader);
	gl.attachShader(program, fragment_shader);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		show_error('Error linking shader program:\n' + gl.getProgramInfoLog(program));
	}
	
	vertex_buffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
		-0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5,
	]), gl.STATIC_DRAW);
	
	frame(0.0);
}

function frame(delta) {
	let width = canvas.offsetWidth;
	let height = canvas.offsetHeight;
	canvas.width = width;
	canvas.height = height;
	gl.viewport(0, 0, width, height);
	gl.clearColor(0.8, 0.9, 1.0, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);
	
	gl.useProgram(program);
	
	gl.uniform4fv(gl.getUniformLocation(program, 'u_color'), [0.1, 0.7, 0.2, 1.0]);
	
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
	
	let v_pos = gl.getAttribLocation(program, 'v_pos');
	gl.enableVertexAttribArray(v_pos);
	gl.vertexAttribPointer(v_pos, 2, gl.FLOAT, false, 0, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
	
	requestAnimationFrame((t) => {
		let delta = t - prev_frame_time;
		prev_frame_time = t;
		frame(delta);
	});
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
	// TODO: display error in browser
	console.log(error);
}
