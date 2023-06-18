'use strict';

/*
TODO:
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
let indices_main = [];
let vertices_changed = false;
let ui_shown = true;
let mouse_pos = {x: -1e10, y: -1e10};
Object.preventExtensions(mouse_pos);
let viewport_width, viewport_height;
let ui_shape = [];
let ui_vertices = [];
let ui_vertex_properties_div;
let ui_color_input;
let ui_color_mix_input;
let ui_grid_divisions_x_input, ui_grid_divisions_y_input;
let ui_div;
let vertex_id = 0;
let shift_key = false;
let ctrl_key = false;

const TOOL_TRIANGLE = 1;
const TOOL_UV = 2;
const TOOL_SELECT = 3;

let ui_tool;

const vertex_radius = 10;
// radius for snapping to vertices, selecting vertices
const vertex_mouse_radius = 10;

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

function ui_escape_tool() {
	ui_vertices = [];
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

function on_key_release(e) {
	update_key_modifiers_from_event(e);
}

function ndc_to_px(pos) {
	let point = {
		x: (pos.x * 0.5 + 0.5) * viewport_width,
		y: (-pos.y * 0.5 + 0.5) * viewport_height,
	};
	Object.preventExtensions(point);
	return point;
}


function px_to_ndc(pos) {
	let point = {
		x: 2 * pos.x / viewport_width - 1,
		y: 1 - 2 * pos.y / viewport_height,
	};
	Object.preventExtensions(point);
	return point;
}


function get_mouse_pos_from_event(e) {
	if (e.target !== canvas && e.target !== ui_canvas) {
		mouse_pos = {x: -1e10, y: -1e10};
	} else {
		mouse_pos = px_to_ndc({x: e.offsetX, y: e.offsetY});
	}
}

function on_mouse_move(e) {
	update_key_modifiers_from_event(e);
	get_mouse_pos_from_event(e);
}

function is_mouse_in_canvas() {
	return Math.abs(mouse_pos.x) <= 1 && Math.abs(mouse_pos.y) <= 1;
}

function distance(p0, p1) {
	let dx = p0.x - p1.x;
	let dy = p0.y - p1.y;
	return Math.sqrt(dx * dx + dy * dy);
}

function snapped_pos(p) {
	let px = ndc_to_px(p);
	let closest_pos = null;
	let closest_dist = Infinity;
	function consider_pos(v) {
		let dist = distance(ndc_to_px(v), px);
		if (dist < closest_dist) {
			closest_dist = dist;
			closest_pos = v;
		}
	}
	vertices_main.forEach(consider_pos);
	ui_vertices.forEach(consider_pos);
	const g = ui_grid_divisions();
	for (let y = 0; y <= g.y; ++y) {
		for (let x = 0; x <= g.x; ++x) {
			consider_pos({
				x: x / g.x * 2 - 1,
				y: y / g.y * 2 - 1,
			});
		}
	}
	if (closest_dist < vertex_mouse_radius) {
		return Object.preventExtensions({
			x: closest_pos.x,
			y: closest_pos.y,
		});
	}
	return Object.preventExtensions({x: p.x, y: p.y});
}

function snapped_mouse_pos() {
	return ctrl_key ? mouse_pos : snapped_pos(mouse_pos);
}

function lerp(a, b, x) {
	return a + (b - a) * x;
}

const VERTEX_POS = 0;
const VERTEX_UV = 8;
const VERTEX_COLOR = 16;
const VERTEX_SIZE = 32;

function get_vertex_data() {
	let array = new Uint8Array(indices_main.length * VERTEX_SIZE);
	indices_main.forEach(function (i) {
		let vertex = vertices_main[i];
		array.set(new Uint8Array((new Float32Array([vertex.x, vertex.y])).buffer),
			VERTEX_SIZE * i + VERTEX_POS);
		array.set(new Uint8Array((new Float32Array([vertex.uv.x, vertex.uv.y])).buffer),
			VERTEX_SIZE * i + VERTEX_UV);
		array.set(new Uint8Array((new Float32Array([vertex.color.r, vertex.color.g, vertex.color.b, vertex.color.a])).buffer),
			VERTEX_SIZE * i + VERTEX_COLOR);
	});
	return array;
}

function ui_commit_vertices() {
	let vertices = ui_vertices;
	let indices = [];
	vertices.forEach(function (v) {
		let exists = true;
		let i;
		for (i = 0; i < vertices_main.length; i++) {
			if (vertices_main[i].id === v.id) {
				break;
			}
		}
		if (i === vertices_main.length) {
			vertices_main.push(v);
		}
		indices.push(i);
	});
	if (indices.length === 3) {
		indices_main.push(indices[0], indices[1], indices[2]);
	} else {
		console.error('bad shape length');
	}
	vertices_changed = true;
	
	ui_shape = [];
	ui_vertices = [];
}

function on_click(e) {
	get_mouse_pos_from_event(e);
	update_key_modifiers_from_event(e);
	if (!is_mouse_in_canvas()) {
		return;
	}
	if (!ui_shown) {
		return;
	}
	
	if (ui_is_editing_shape()) {
		let pos = snapped_mouse_pos();
		let vertex = {
			id: ++vertex_id,
			x: pos.x,
			y: pos.y,
			color: rgba_hex_to_float(ui_get_color_rgba()),
		};
		ui_shape.push(vertex);
		switch (ui_tool) {
		case TOOL_TRIANGLE:
			if (ui_shape.length === 3) {
				ui_tool = TOOL_UV;
				ui_vertices = ui_shape;
				ui_shape = [];
				let all_full_alpha = true;
				ui_vertices.forEach(function (v) {
					if (v.color.a < 1) {
						all_full_alpha = false;
					}
				});
				if (all_full_alpha) {
					// skip UV specification; it doesn't matter
					ui_vertices.forEach(function (v) { v.uv = {x: 0, y: 0}; } );
					ui_commit_vertices();
					ui_set_tool(TOOL_SELECT);
				}
			}
			break;
		case TOOL_UV:
			if (ui_shape.length === ui_vertices.length) {
				let uv = ui_shape;
				let vertices = ui_vertices;
				for (let i = 0; i < vertices.length; i++) {
					vertices[i].uv = {x: uv[i].x * 0.5 + 0.5, y: uv[i].y * 0.5 + 0.5};
				}
				ui_commit_vertices();
				ui_set_tool(TOOL_SELECT);
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
	ui_vertex_properties_div = document.getElementById('vertex-properties');
	ui_grid_divisions_x_input = document.getElementById('grid-divisions-x-input');
	ui_grid_divisions_y_input = document.getElementById('grid-divisions-y-input');
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
	window.addEventListener('keyup', on_key_release);
	window.addEventListener('mousemove', on_mouse_move);
	window.addEventListener('click', on_click);
	// set up tool buttons
	Array.prototype.forEach.call(
		document.getElementsByClassName('tool-button'),
		function (tool_button) {
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
	);
}

function ui_is_editing_shape() {
	return ui_tool === TOOL_TRIANGLE || ui_tool === TOOL_UV;
}

function ui_is_editing_vertex() {
	return ui_tool === TOOL_TRIANGLE;
}

function draw_vertex(vertex) {
	ui_circle(vertex, vertex_radius, {
		strokeStyle: '#ffffff',
		fillStyle: rgba_float_to_hex(vertex.color),
	});
}

function frame(time) {
	ui_vertex_properties_div.style.display = ui_is_editing_vertex() ? 'inline-block' : 'none';
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
	ui_canvas.width = viewport_width;
	ui_canvas.height = viewport_height;
	ui_canvas.style.left = canvas_x + 'px';
	ui_canvas.style.top = canvas_y + 'px';
	
	if (vertices_changed) {
		let vertex_data = get_vertex_data();
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
		for (let i = 0; i < vertices_main.length; i++) {
			let vertex = vertices_main[i];
			draw_vertex(vertex);
			if (i % 3 === 0) {
				console.assert(i + 2 < vertices_main.length, 'vertices_main.length not a multiple of 3');
				const line_options = {
					strokeStyle: '#ffffff'
				};
				ui_line(vertex, vertices_main[i+1], line_options);
				ui_line(vertex, vertices_main[i+2], line_options);
				ui_line(vertices_main[i+1], vertices_main[i+2], line_options);
			}
		}
		
		if (ui_tool === TOOL_UV) {
			ui_polygon(ui_vertices, {
				strokeStyle: '#ffffff',
				fillStyle: '#ffffff44',
			});
			ui_vertices.forEach(draw_vertex);
		}
		
		if (ui_is_editing_shape()) {
			let color;
			if (ui_tool == TOOL_UV) {
				color = '#3333ff';
			} else {
				color = '#ffffff';
			}
			let options_shape = {
				strokeStyle: color,
				fillStyle: color + '44',
			};
			
			if (ui_shape.length < 3 && is_mouse_in_canvas()) {
				let mpos = snapped_mouse_pos();
				
				// vertex where the mouse is
				ui_circle(mpos, vertex_radius, {
					strokeStyle: options_shape.strokeStyle,
					fillStyle: ui_tool === TOOL_UV ? color + '44' : ui_get_color_rgba(),
				});
				
				if (ui_shape.length === 1) {
					ui_line(ui_shape[0], mpos, options_shape);
				} else if (ui_shape.length === 2) {
					// triangle preview
					ui_polygon([ui_shape[0], ui_shape[1], mpos], options_shape);
				}
			}
			
			for (let i = 0; i < ui_shape.length; i++) {
				let vertex = ui_shape[i];
				
				if (i > 0 && ui_shape.length < 3) {
					let prev = ui_shape[i - 1];
					ui_line(prev, vertex, options_shape);
				}
				
				ui_circle(vertex, vertex_radius, {
					strokeStyle: options_shape.strokeStyle,
					fillStyle: ui_tool === TOOL_UV ? color + '44' : rgba_float_to_hex(vertex.color),
				});
			}
			
		}
		
		{ // draw grid
			const g = ui_grid_divisions();
			const options = {
				strokeStyle: '#ffffff66',
			};
			for (let y = 1; y < g.y; ++y) {
				let v = y / g.y * 2 - 1;
				ui_line({x: -1, y: v}, {x: 1, y: v}, options);
			}
			
			for (let x = 1; x < g.x; ++x) {
				let v = x / g.x * 2 - 1;
				ui_line({x: v, y: -1}, {x: v, y: 1}, options);
			}
		}
		
	}
}

function ui_grid_divisions() {
	let x = parseInt(ui_grid_divisions_x_input.value);
	let y = parseInt(ui_grid_divisions_y_input.value);
	if (isNaN(x) || isNaN(y) || x <= 0 || y <= 0 || x >= 100 || y >= 100) {
		return null;
	}
	return Object.preventExtensions({x: x, y: y});
}

function ui_circle(pos, r, options) {
	pos = ndc_to_px(pos);
	ui_ctx.beginPath();
	ui_ctx.strokeStyle = 'strokeStyle' in options ? options.strokeStyle : '#000';
	ui_ctx.fillStyle = 'fillStyle' in options ? options.fillStyle : 'transparent';
	ui_ctx.lineWidth = 'lineWidth' in options ? options.lineWidth : 2;
	ui_ctx.ellipse(pos.x, pos.y, r, r, 0, 0, 2 * Math.PI);
	ui_ctx.stroke();
	ui_ctx.fill();
}

function ui_line(p0, p1, options) {
	p0 = ndc_to_px(p0);
	p1 = ndc_to_px(p1);
	ui_ctx.beginPath();
	ui_ctx.strokeStyle = 'strokeStyle' in options ? options.strokeStyle : '#000';
	ui_ctx.lineWidth = 'lineWidth' in options ? options.lineWidth : 2;
	ui_ctx.moveTo(p0.x, p0.y);
	ui_ctx.lineTo(p1.x, p1.y);
	ui_ctx.stroke();
}

function ui_polygon(vertices, options) {
	console.assert(vertices.length >= 3, 'polygon must have at least 3 vertices');
	ui_ctx.beginPath();
	ui_ctx.strokeStyle = 'strokeStyle' in options ? options.strokeStyle : '#000';
	ui_ctx.fillStyle = 'fillStyle' in options ? options.fillStyle : 'transparent';
	ui_ctx.lineWidth = 'lineWidth' in options ? options.lineWidth : 2;
	const v0 = ndc_to_px(vertices[0]);
	ui_ctx.moveTo(v0.x, v0.y);
	for (let i = 1; i < vertices.length; i++) {
		const v = ndc_to_px(vertices[i]);
		ui_ctx.lineTo(v.x, v.y);
	}
	ui_ctx.lineTo(v0.x, v0.y);
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
	if (indices_main.length >= 0) {
		let v_pos = gl.getAttribLocation(program_main, 'v_pos');
		let v_uv = gl.getAttribLocation(program_main, 'v_uv');
		let v_color = gl.getAttribLocation(program_main, 'v_color');
		gl.enableVertexAttribArray(v_pos);
		gl.enableVertexAttribArray(v_uv);
		gl.enableVertexAttribArray(v_color);
		gl.vertexAttribPointer(v_pos,    2, gl.FLOAT, false, VERTEX_SIZE, VERTEX_POS);
		gl.vertexAttribPointer(v_uv,     2, gl.FLOAT, false, VERTEX_SIZE, VERTEX_UV);
		gl.vertexAttribPointer(v_color,  4, gl.FLOAT, false, VERTEX_SIZE, VERTEX_COLOR);
		gl.drawArrays(gl.TRIANGLES, 0, indices_main.length);
	}
	
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
