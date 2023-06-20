'use strict';

/*
TODO:
- prev controls:
    - wrap?
    - filter
- detect circular dependencies
- detect duplicate widget names
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
	let r;
	let g;
	let b;
	let a;
	
	if (hex.length === 7 || hex.length === 9) {
		// #rrggbb or #rrggbbaa
		r = parseInt(hex.substr(1, 2), 16) / 255;
		g = parseInt(hex.substr(3, 2), 16) / 255;
		b = parseInt(hex.substr(5, 2), 16) / 255;
		a = hex.length === 7 ? 1 : parseInt(hex.substr(7, 2), 16) / 255;
	} else if (hex.length === 4 || hex.length === 5) {
		// #rgb or #rgba
		r = parseInt(hex.substr(1, 1), 16) / 15;
		g = parseInt(hex.substr(2, 1), 16) / 15;
		b = parseInt(hex.substr(3, 1), 16) / 15;
		a = hex.length === 4 ? 1 : parseInt(hex.substr(4, 1), 16) / 15;
	}

	if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) {
		return null;
	}
	
	let color = {
		r: r,
		g: g,
		b: b,
		a: a,
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

function update_shader() {
	let source = get_shader_source();
	if (source === null)
		return;
	let fragment_code = `
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D u_texture;
uniform float u_time;
varying vec2 pos;

vec3 get_color() {
	${source}
}

void main() {
	gl_FragColor = vec4(get_color(), 1.0);
}
`;
	const vertex_code = `
attribute vec2 v_pos;
varying vec2 pos;
void main() {
	pos = v_pos;
	gl_Position = vec4(v_pos, 0.0, 1.0);
}
`;
	program_main = compile_program('main', {'vertex': vertex_code, 'fragment': fragment_code});
}

function on_key_press(e) {
	update_key_modifiers_from_event(e);
	let code = e.keyCode;
	if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
		return;
	}
	console.log('key press', code);
	
	switch (code) {
	case 32: // space
		if (canvas_is_target)
			perform_step();
		break;
	case 9: // tab
		set_ui_shown(!ui_shown);
		e.preventDefault();
		break;
	case 13: // return
		update_shader();
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


function float_glsl(f) {
	if (isNaN(f)) return '(0.0 / 0.0)';
	if (f === Infinity) return '1e+1000';
	if (f === -Infinity) return '-1e+1000';
	let s = f + '';
	if (s.indexOf('.') !== -1 || s.indexOf('e') !== -1)
		return s;
	return s + '.0';
}

function type_component_count(type) {
	switch (type) {
	case 'float': return 1;
	case 'vec2': return 2;
	case 'vec3': return 3;
	case 'vec4': return 4;
	default:
		return 0;
	}
}

function type_base_type(type) {
	switch (type) {
	case 'float':
	case 'vec2':
	case 'vec3':
	case 'vec4':
		return 'float';
	default:
		return null;
	}
}

function type_vec(base_type, component_count) {
	switch (base_type) {
	case 'float':
		switch (component_count) {
		case 1: return 'float';
		case 2: return 'vec2';
		case 3: return 'vec3';
		case 4: return 'vec4';
		default:
			return null;
		}
	default:
		return null;
	}
}

class GLSLGenerationState {
	constructor(widgets) {
		this.widgets = widgets;
		this.code = [];
		this.variable = 0;
		this.has_error = false;
	}
	
	next_variable() {
		this.variable += 1;
		return 'v' + this.variable;
	}
	
	add_code(code) {
		this.code.push(code);
	}
	
	error(message) {
		this.has_error = true;
		show_error(message);
	}
	
	get_code() {
		return this.code.join('');
	}
	
	compute_input(input) {
		input = input.trim();
		if (this.has_error) return null;
		if (!isNaN(input)) return { code: float_glsl(parseFloat(input)), type: 'float' };
		
		if (input.indexOf(',') !== -1) {
			// vector construction
			let items = input.split(',');
			console.assert(items.length >= 2, 'huhhhhh??');
			let components = [];
			for (let item of items) {
				components.push(this.compute_input(item));
			}
			if (this.has_error)
				return null;
			let component_count = 0;
			let base_type = undefined;
			for (let component of components) {
				let type = component.type;
				let c = type_component_count(type);
				if (c === 0) {
					this.error(`cannot use type ${type} with ,`);
					return null;
				}
				component_count += c;
				if (base_type === undefined) {
					base_type = type_base_type(type);
				}
				if (base_type !== type_base_type(type)) {
					this.error('bad combination of types for ,');
					return null;
				}
			}
			let type = type_vec(base_type, component_count);
			if (type === null) {
				// e.g. trying to combine 5 floats
				this.error('bad combination of types for ,');
				return null;
			}
			let v = this.next_variable();
			let component_values = components.map(function (c) { return c.code; });
			this.add_code(`${type} ${v} = ${type}(${component_values.join()});\n`);
			return {type: type, code: v};
		}
		
		if (input[0] === '#') {
			let color = rgba_hex_to_float(input);
			if (color === null) {
				this.error('bad color: ' + input);
				return null;
			}
			return input.length === 4 || input.length === 7 ?
				{ code: `vec3(${float_glsl(color.r)},${float_glsl(color.g)},${float_glsl(color.b)})`, type: 'vec3' } :
				{ code: `vec4(${float_glsl(color.r)},${float_glsl(color.g)},${float_glsl(color.b)},${float_glsl(color.a)})`, type: 'vec4' };
		}
		
		let dot = input.lastIndexOf('.');
		let field = dot === -1 ? 'out' : input.substr(dot + 1);
		
		if (field.length === 0) {
			this.error('inputs should not end in .');
			return null;
		}
		
		if (field.length >= 1 && field.length <= 4 && field.split('').every(function (c) { return 'xyzw'.indexOf(c) !== -1 })) {
			// swizzle
			let vector = this.compute_input(input.substr(0, dot));
			let base = type_base_type(vector.type);
			let count = type_component_count(vector.type);
			
			for (let c of field) {
				let i = 'xyzw'.indexOf(c);
				if (i >= count) {
					this.error(`type ${vector.type} has no field ${c}.`);
					return null;
				}
			}
			
			return {code: `(${vector.code}).${field}`, type: type_vec(base, field.length)};
		}
		
		if (dot === 0) {
			switch (input) {
			case '.pos':
				return {code: 'pos', type: 'vec2'};
			case '.pos01':
				return {code: '(0.5+0.5*pos)', type: 'vec2'};
			case '.time':
				return {code: 'u_time', type: 'float'};
			default:
				this.error(`no such builtin: ${input}`);
				return null;
			}
		}
		
		if (dot !== -1) {
			input = input.substr(0, dot);
		}
		let widget = this.widgets['-' + input];
		if (widget === undefined) {
			this.error('cannot find ' + input);
			return null;
		}
		return this.compute_widget_output(widget, field);
	}
	
	compute_widget_output(widget, output) {
		if (this.has_error) return null;
		
		if (!(output in widget.outputs)) {
			this.error('function ' + widget.func + ' has no output ' + output);
			return null;
		}
		if (widget.outputs[output] !== null) {
			// already computed
			return widget.outputs[output];
		}
		
		let ret = null;
		switch (widget.func) {
		case 'mix': {
			let src1 = this.compute_input(widget.inputs['src1']);
			let src2 = this.compute_input(widget.inputs['src2']);
			let mix = this.compute_input(widget.inputs['mix']);
			if (this.has_error) return null;
			
			let types_good = type_base_type(src1.type) === 'float' &&
				type_base_type(src2.type) === 'float' &&
				type_base_type(mix.type) === 'float' &&
				type_component_count(src1.type) === type_component_count(src2.type) &&
				(type_component_count(mix.type) === type_component_count(src1.type) ||
				 type_component_count(mix.type) === 1);
			if (!types_good) {
				this.error('bad types for mix: ' + [src1, src2, mix].map(function (x) { return x.type; }).join(', '));
				return null;
			}
			
			let type = src1.type;
			let v = this.next_variable();
			this.add_code(`${type} ${v} = mix(${src1.code}, ${src2.code}, ${mix.code});\n`);
			ret = {type: type, code: v};
			}
			break;
		case 'prev': {
			let pos = this.compute_input(widget.inputs['pos']);
			if (this.has_error) return null;
			if (pos.type !== 'vec2') {
				this.error('bad type for sample position: ' + pos.type);
				return null;
			}
			
			let v = this.next_variable();
			this.add_code(`vec3 ${v} = texture2D(u_texture, ${pos.code}).xyz;\n`);
			ret = {type: 'vec3', code: v};
			} break;
		case 'output':
			ret = this.compute_input(widget.inputs['value']);
			break;
		case 'mul': {
			let a = this.compute_input(widget.inputs['a']);
			let b = this.compute_input(widget.inputs['b']);
			if (this.has_error) return null;
			if (a.type !== b.type && a.type !== type_base_type(b.type) && b.type !== type_base_type(a.type)) {
				this.error(`cannot multiply types ${a.type} and ${b.type}`);
				return null;
			}
			
			let output_type = a.type === type_base_type(b.type) ? b.type : a.type;
			let v = this.next_variable();
			this.add_code(`${output_type} ${v} = ${a.code} * ${b.code};\n`);
			ret = {code: v, type: output_type};
			} break;
		case 'mod': {
			let a = this.compute_input(widget.inputs['a']);
			let b = this.compute_input(widget.inputs['b']);
			if (this.has_error) return null;
			if (a.type !== b.type && a.type !== type_base_type(b.type) && b.type !== type_base_type(a.type)) {
				this.error(`cannot take type ${a.type} modulo type ${b.type}`);
				return null;
			}
			
			let output_type = a.type === type_base_type(b.type) ? b.type : a.type;
			let v = this.next_variable();
			this.add_code(`${output_type} ${v} = mod(${output_type}(${a.code}), ${output_type}(${b.code}));\n`);
			ret = {code: v, type: output_type};
			} break;
		case 'square': {
			// square selector
			let pos = this.compute_input(widget.inputs['pos']);
			let inside = this.compute_input(widget.inputs['inside']);
			let outside = this.compute_input(widget.inputs['outside']);
			let size = this.compute_input(widget.inputs['size']);
			if (this.has_error) return null;
			if (type_base_type(pos.type) !== 'float') {
				this.error('bad type for input pos: ' + pos.type);
				return null;
			}
			let output_type = inside.type;
			if (output_type !== outside.type) {
				this.error(`selector input types ${inside.type} and ${outside.type} do not match`);
				return null;
			}
			if (size.type !== 'float' && size.type !== pos.type) {
				this.error(`bad type for square size: ${size.type}`);
				return null;
			}
			let a = this.next_variable();
			let b = this.next_variable();
			let v = this.next_variable();
			this.add_code(`${pos.type} ${a} = abs(${pos.code} / ${size.code});\n`);
			switch (type_component_count(pos.type)) {
			case 1:
				b = a;
				break;
			case 2:
				this.add_code(`float ${b} = max(${a}.x,${a}.y);\n`);
				break;
			case 3:
				this.add_code(`float ${b} = max(${a}.x,max(${a}.y,${a}.z));\n`);
				break;
			case 4:
				this.add_code(`float ${b} = max(${a}.x,max(${a}.y,max(${a}.z,${a}.w)));\n`);
				break;
			}
			this.add_code(`${output_type} ${v} = ${b} < 1.0 ? ${inside.code} : ${outside.code};\n`);
			ret = {code: v, type: output_type};
			} break;
		default:
			console.assert(false, 'bad function');
			break;
		}
		console.assert(output !== null, 'ret not set');
		widget.outputs[output] = ret;
		return ret;
	}
}

function get_shader_source() {
	let widgets = {};
	let output_widget = null;
	for (let widget_div of document.getElementsByClassName('widget')) {
		let names = widget_div.getElementsByClassName('name');
		console.assert(names.length <= 1, 'multiple name inputs for widget');
		let name = names.length > 0 ? names[0].value : null;
		let func = widget_div.dataset.func;
		let inputs = {};
		for (let input of widget_div.getElementsByClassName('in')) {
			let name = input.getElementsByTagName('label')[0].innerText;
			inputs[name] = input.getElementsByTagName('input')[0].value;
		}
		let widget = {
			func: func,
			inputs: inputs,
			outputs: {},
		};
		for (let output of widget_div.getElementsByClassName('out')) {
			widget.outputs[output.innerText] = null;
		}
		if (name !== null) {
			widgets['-' + name] = widget;
		}
		if (func === 'output') {
			output_widget = widget;
		}
	}
	
	let state = new GLSLGenerationState(widgets);
	if (output_widget === null) {
		state.error('no output color');
		return null;
	}
	output_widget.outputs['out'] = null;
	let output = state.compute_widget_output(output_widget, 'out');
	if (state.has_error) return null;
	if (output.type !== 'vec3') {
		state.error('output color should have type vec3, but it has type ' + output.type);
		return null;
	}
	state.add_code(`return ${output.code};\n`)
	let code = state.get_code();
	console.log(code);
	return code;
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
	
	program_main = compile_program('main', {
		'vertex': `
attribute vec2 v_pos;
varying vec2 uv;
void main() {
	uv = v_pos * 0.5 + 0.5;
	gl_Position = vec4(v_pos, 0.0, 1.0);
}`,
		'fragment': `
#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D u_texture;
uniform float u_time;
varying vec2 uv;

void main() {
	vec2 u = pow(uv,vec2(1.2 + 0.4 * sin(u_time)));
	vec2 k =floor(3.0 * u); 
	int i = int(k.y * 3.0 + k.x);
	if (i == 4) discard;
	vec3 sample = texture2D(u_texture, mod(3.0*u, 1.0)).xyz;
	float h = mod(float(i) * 5.0, 8.0) / 8.0;
	sample = vec3(
		mix(sample.x, sample.z, h),
		mix(sample.y, sample.x, h),
		mix(sample.z, sample.y, h)
	);
	gl_FragColor = vec4(mix(sample, vec3(1.0,0.0,0.0), 0.2),1.0);
}
`
	});
	if (program_main === null) {
		return;
	}
	
	program_post = compile_program('post', {
		'vertex': `
attribute vec2 v_pos;
varying vec2 uv;
void main() {
	uv = v_pos * 0.5 + 0.5;
	gl_Position = vec4(v_pos, 0.0, 1.0);
}
`,
		'fragment': `
#ifdef GL_ES
precision highp float;
#endif
uniform sampler2D u_texture;
varying vec2 uv;
void main() {
	gl_FragColor = texture2D(u_texture, uv);
}
`,
	});
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
	let ui_width = ui_shown ? ui_div.offsetWidth : 0;
	let page_width = page.offsetWidth - ui_width;
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
	canvas.style.left = ui_width + canvas_x + 'px';
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
	for (let type in shaders) {
		let source = shaders[type];
		let gl_type;
		if (type === 'vertex') {
			gl_type = gl.VERTEX_SHADER;
		} else if (type === 'fragment') {
			gl_type = gl.FRAGMENT_SHADER;
		} else {
			show_error('unrecognized shader type: ' + type);
		}
		let shader = compile_shader(name + ' ' + type, gl_type, source);
		if (shader === null)
			return null;
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
