'use strict';

/*
TODO:
- skip UV specification if opacity === 1
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
let vertices_main = [];
let vertices_changed = false;
let ui_shown = true;
let mouse_x, mouse_y;
let viewport_width, viewport_height, viewport_scale;
let ui_shape = [];
let ui_vertex_positions = [];
let ui_color_input;
let ui_color_mix_input;
let ui_div;

const TOOL_TRIANGLE = 1;
const TOOL_UV = 2;
const TOOL_SELECT = 3;

let ui_tool;

const vertex_radius = 10;

let width = 1920, height = 1920;

window.addEventListener('load', startup);

function set_ui_shown(to) {
	ui_shown = to;
	ui_div.style.visibility = to ? 'visible' : 'collapse';
	page.dataset.uiShown = to ? '1' : '0';
}

function ui_get_color() {
	return ui_color_input.value;
}

function ui_get_color_mix() {
	let v = parseFloat(ui_color_mix_input.value);
	return !isNaN(v) && v >= 0.0 && v <= 1.0 ? v : 0.0;
}

function ui_get_color_rgba() {
	let alpha = Math.floor(ui_get_color_mix() * 255).toString(16);
	while (alpha.length < 2) {
		alpha = '0' + alpha;
	}
	return ui_get_color() + alpha;
}

function hex_to_rgba(hex) {
	return {
		r: parseInt(hex.substr(1, 2), 16) / 255,
		g: parseInt(hex.substr(3, 2), 16) / 255,
		b: parseInt(hex.substr(5, 2), 16) / 255,
		a: hex.length <= 7 ? 1 : parseInt(hex.substr(7, 2), 16) / 255,
	};
}

function ui_escape_tool() {
	ui_vertex_positions = [];
	ui_shape = [];
	ui_tool = TOOL_SELECT;
}

function ui_set_tool(tool) {
	if (ui_tool === tool) {
		return;
	}
	ui_escape_tool();
	ui_tool = tool;
	let tool_buttons = document.getElementsByClassName('tool-button');
	for (let i = 0; i < tool_buttons.length; i++) {
		let button = tool_buttons[i];
		button.dataset.selected = parseInt(button.dataset.tool) === tool;
	}
}

function on_key_press(e) {
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
	case 27: // escape
		ui_escape_tool();
		break;
	case 49: // 1
		ui_set_tool(TOOL_SELECT);
		break;
	case 50: // 2
		ui_set_tool(TOOL_TRIANGLE);
		break;
	}
}

function get_mouse_pos_from_event(e) {
	if (e.target !== canvas && e.target !== ui_canvas) {
		mouse_x = -1e10;
		mouse_y = -1e10;
	} else {
		mouse_x = e.offsetX / viewport_scale;
		mouse_y = e.offsetY / viewport_scale;
	}
}

function on_mouse_move(e) {
	get_mouse_pos_from_event(e);
}

function is_mouse_in_canvas() {
	return mouse_x >= 0 && mouse_y >= 0 && mouse_x < width && mouse_y < height;
}

function lerp(a, b, x) {
	return a + (b - a) * x;
}

function vertices_push_triangle(v0, v1, v2) {
	Object.preventExtensions(v0);
	Object.preventExtensions(v1);
	Object.preventExtensions(v2);
	vertices_main.push(v0);
	vertices_main.push(v1);
	vertices_main.push(v2);
	vertices_changed = true;
}

function vertices_push_quad(v0, v1, v2, v3) {
	vertices_push_triangle(v0, v1, v2);
	vertices_push_triangle(v0, v2, v3);
}

const VERTEX_POS = 0;
const VERTEX_UV = 8;
const VERTEX_COLOR = 16;
const VERTEX_SIZE = 32;

function vertices_to_uint8_array(vertices) {
	let array = new Uint8Array(vertices.length * VERTEX_SIZE);
	for (var i = 0; i < vertices.length; i++) {
		let vertex = vertices[i];
		array.set(new Uint8Array((new Float32Array([vertex.pos.x, vertex.pos.y])).buffer),
			VERTEX_SIZE * i + VERTEX_POS);
		array.set(new Uint8Array((new Float32Array([vertex.uv.x, vertex.uv.y])).buffer),
			VERTEX_SIZE * i + VERTEX_UV);
		array.set(new Uint8Array((new Float32Array([vertex.color.r, vertex.color.g, vertex.color.b, vertex.color.a])).buffer),
			VERTEX_SIZE * i + VERTEX_COLOR);
	}
	return array;
}

function convert_viewport_pos_to_ndc(pos) {
	return {
		x: pos.x / width * 2 - 1,
		y: 1 - pos.y / height * 2,
	};
}

function convert_viewport_pos_to_uv(pos) {
	return {
		x: pos.x / width,
		y: 1.0 - pos.y / height,
	};
}

function on_click(e) {
	get_mouse_pos_from_event(e);
	if (!is_mouse_in_canvas()) {
		return;
	}
	if (!ui_shown) {
		return;
	}
	
	if (ui_is_editing_shape()) {
		let vertex = {
			x: mouse_x,
			y: mouse_y,
		};
		Object.preventExtensions(vertex);
		ui_shape.push(vertex);
		switch (ui_tool) {
		case TOOL_TRIANGLE:
			if (ui_shape.length === 3) {
				ui_tool = TOOL_UV;
				ui_vertex_positions = ui_shape;
				ui_shape = [];
			}
			break;
		case TOOL_UV:
			if (ui_shape.length === ui_vertex_positions.length) {
				let pos = ui_vertex_positions;
				let uv = ui_shape;
				let vertices = [];
				for (let i in pos) {
					let color = hex_to_rgba(ui_get_color());
					color.a = ui_get_color_mix();
					vertices.push({
						pos: convert_viewport_pos_to_ndc(pos[i]),
						uv: convert_viewport_pos_to_uv(uv[i]),
						color: color,
					});
				}
				console.log(vertices);
				if (vertices.length === 3) {
					vertices_push_triangle(vertices[0], vertices[1], vertices[2]);
				} else if (vertices.length === 4) {
					vertices_push_quad(vertices[0], vertices[1], vertices[2], vertices[3]);
				} else {
					console.error('bad shape length');
				}
				ui_tool = TOOL_TRIANGLE;
				ui_shape = [];
				ui_vertex_positions = [];
			}
			break;
		}
	}
}

function startup() {
	page = document.getElementById('page');
	canvas = document.getElementById('canvas');
	ui_div = document.getElementById('ui');
	ui_canvas = document.getElementById('ui-canvas');
	ui_color_input = document.getElementById('color-input');
	ui_color_mix_input = document.getElementById('color-mix-input');
	ui_ctx = ui_canvas.getContext('2d');
	
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
	
	framebuffer_color_texture = gl.createTexture();
	sampler_texture = gl.createTexture();
	
	set_up_framebuffer();
	
	ui_set_tool(TOOL_TRIANGLE);
	
	frame(0.0);
	window.addEventListener('keydown', on_key_press);
	window.addEventListener('mousemove', on_mouse_move);
	window.addEventListener('click', on_click);
	{ // set up tool buttons
		let tool_buttons = document.getElementsByClassName('tool-button');
		for (let i = 0; i < tool_buttons.length; i++) {
			let tool_button = tool_buttons[i];
			tool_button.addEventListener('click', function(e) {
				let button = e.target;
				while (button !== null && button.tagName !== 'BUTTON') {
					button = button.parentElement;
				}
				console.assert(button !== null, 'what how did the event listener fire then');
				let n = parseInt(button.dataset.tool);
				console.assert(!isNaN(n), 'bad data-tool value: ' + button.dataset.tool);
				ui_set_tool(n);
			});
		}
	}
}

function ui_is_editing_shape() {
	return ui_tool == TOOL_TRIANGLE || ui_tool == TOOL_UV;
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
	viewport_scale = viewport_width / width;
	
	canvas.width = viewport_width;
	canvas.height = viewport_height;
	canvas.style.left = canvas_x + 'px';
	canvas.style.top = canvas_y + 'px';
	ui_canvas.width = viewport_width;
	ui_canvas.height = viewport_height;
	ui_canvas.style.left = canvas_x + 'px';
	ui_canvas.style.top = canvas_y + 'px';
	
	if (vertices_changed) {
		let vertex_data = vertices_to_uint8_array(vertices_main);
		gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_main);
		gl.bufferData(gl.ARRAY_BUFFER, vertex_data, gl.DYNAMIC_DRAW);
		vertices_changed = false;
	}
	
	
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
	
	ui_ctx.clearRect(0, 0, width, height);
	
	if (ui_shown) {
		if (ui_tool === TOOL_UV) {
			ui_polygon(ui_vertex_positions, {
				strokeStyle: '#ffffff',
				fillStyle: '#ffffff44',
			});
		}
		
		if (ui_is_editing_shape()) {
			let options_vertex, options_shape;
			if (ui_tool == TOOL_UV) {
				let color = '#3333ff';
				options_vertex = {
					strokeStyle: color,
					fillStyle: color + '44'
				};
				options_shape = options_vertex;
			} else {
				options_vertex = {
					strokeStyle: '#ffffff',
					fillStyle: ui_get_color() + '44',
				};
				options_shape = {
					strokeStyle: '#ffffff',
					fillStyle: '#ffffff44',
				};
			}
			
			if (ui_shape.length < 3 && is_mouse_in_canvas()) {
				// vertex where the mouse is
				ui_circle(mouse_x, mouse_y, vertex_radius, options_vertex);
				let vmouse = {x: mouse_x, y: mouse_y};
				
				if (ui_shape.length === 1) {
					ui_line(ui_shape[0].x, ui_shape[0].y, vmouse.x, vmouse.y, options_shape);
				} else if (ui_shape.length === 2) {
					// triangle preview
					ui_polygon([ui_shape[0], ui_shape[1], vmouse], options_shape);
				}
			}
			
			for (let i in ui_shape) {
				let vertex = ui_shape[i];
				
				if (i > 0 && ui_shape.length < 3) {
					let prev = ui_shape[i - 1];
					ui_line(prev.x, prev.y, vertex.x, vertex.y, options_shape);
				}
				
				ui_circle(vertex.x, vertex.y, vertex_radius, options_vertex);
			}
			
		}
		
	}
}

function ui_circle(x, y, r, options) {
	x *= viewport_scale;
	y *= viewport_scale;
	ui_ctx.beginPath();
	ui_ctx.strokeStyle = 'strokeStyle' in options ? options.strokeStyle : '#000';
	ui_ctx.fillStyle = 'fillStyle' in options ? options.fillStyle : 'transparent';
	ui_ctx.lineWidth = 'lineWidth' in options ? options.lineWidth : 2;
	ui_ctx.ellipse(x, y, r, r, 0, 0, 2 * Math.PI);
	ui_ctx.stroke();
	ui_ctx.fill();
}

function ui_line(x0, y0, x1, y1, options) {
	x0 *= viewport_scale;
	y0 *= viewport_scale;
	x1 *= viewport_scale;
	y1 *= viewport_scale;
	ui_ctx.beginPath();
	ui_ctx.strokeStyle = 'strokeStyle' in options ? options.strokeStyle : '#000';
	ui_ctx.lineWidth = 'lineWidth' in options ? options.lineWidth : 2;
	ui_ctx.moveTo(x0, y0);
	ui_ctx.lineTo(x1, y1);
	ui_ctx.stroke();
}

function ui_polygon(vertices, options) {
	console.assert(vertices.length >= 3, 'polygon must have at least 3 vertices');
	ui_ctx.beginPath();
	ui_ctx.strokeStyle = 'strokeStyle' in options ? options.strokeStyle : '#000';
	ui_ctx.fillStyle = 'fillStyle' in options ? options.fillStyle : 'transparent';
	ui_ctx.lineWidth = 'lineWidth' in options ? options.lineWidth : 2;
	ui_ctx.moveTo(vertices[0].x * viewport_scale, vertices[0].y * viewport_scale);
	for (let i in vertices) {
		if (i == 0) continue;
		const v = vertices[i];
		ui_ctx.lineTo(v.x * viewport_scale, v.y * viewport_scale);
	}
	ui_ctx.lineTo(vertices[0].x * viewport_scale, vertices[0].y * viewport_scale);
	ui_ctx.stroke();
	ui_ctx.fill();
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
	
function compile_program(name, shaders) {
	let program = gl.createProgram();
	for (let i in shaders) {
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
