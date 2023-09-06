'use strict';

const APP_ID = 'dh3YgVZQdX1Q';

function generate_creation_id() {
	const parts = new Uint16Array(6);
	crypto.getRandomValues(parts);
	return Array.from(parts)
		.map((x) => {
			x = x.toString(16);
			while (x.length < 4) x = '0' + x;
			return x;
		})
		.join('-');
}

function parse_json(s) {
	try {
		return JSON.parse(s);
	} catch (e) {
		return undefined;
	}
}

let gl;
let program_main = null;
let program_post = null;
let vertex_buffer_rect;
let vertex_buffer_main;
let canvas_container;
let canvas;
let framebuffer;
let framebuffer_color_texture;
let sampler_texture;
let current_time = 0;
let ui_shown = true;
let ui_div;
let ui_resize;
let viewport_width, viewport_height;
let next_html_id = 1;
let next_widget_id = 1;
let widget_choices;
let widget_search;
let widgets_container;
let code_input;
let error_element;
let parsed_widgets;
let paused = false;
let pause_element;
let step_element;
let play_element;
let creation_metadata = {};
let creation_id;
let creation_title_element;
let auto_update_element;

const mouse_pos_ndc = Object.preventExtensions({ x: 0, y: 0 });

let render_width = 1080;
let render_height = 1080;
const GLSL_FLOAT_TYPES = ['float', 'vec2', 'vec3', 'vec4'];
const GLSL_FLOAT_TYPE_PAIRS = GLSL_FLOAT_TYPES.flatMap((x) =>
	GLSL_FLOAT_TYPES.map((y) => [x, y])
);

const builtin_widgets = [
	`
//! .name: Buffer
//! .category: basic
//! .description: outputs its input unaltered. useful for defining constants.
//! x.name: input
//! x.id: input
` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} buffer(${type} x) {
	return x;
}`
		).join('\n'),
	`
//! .name: Slider
//! .category: basic
//! .description: an adjustable slider between two values.
//! x.id: x
//! x.default: 0.5
//! x.control: slider
//! min_val.id: min
//! min_val.default: 0
//! max_val.id: max
//! max_val.default: 1

float slider(float x, float min_val, float max_val) {
	return mix(min_val, max_val, x);
}
`,
	`
//! .name: Mix (lerp)
//! .category: basic
//! .id: mix
//! .description: weighted average of two inputs
//! a.name: source 1
//! a.default: 0
//! b.name: source 2
//! b.default: 1
//! x.name: mix
//! x.default: 0.5
//! c.name: clamp mix
//! c.control: checkbox
//! c.description: clamp the mix input to the [0, 1] range
` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} mix_(${type} a, ${type} b, ${type} x, int c) {
	if (c != 0) x = clamp(x, 0.0, 1.0);
	return mix(a, b, x);
}
`
		).join('\n'),
	`
//! .name: Last frame
//! .category: basic
//! .id: prev
//! .description: sample from the previous frame
//! pos.description: position to sample — bottom-left corner is (−1, −1), top-right corner is (1, 1)
//! pos.default: .pos
//! wrap.name: wrap mode
//! wrap.control: select:clamp|wrap
//! wrap.description: how to deal with the input components if they go outside [−1, 1]
//! samp.id: sample
//! samp.name: sample mode
//! samp.control: select:linear|nearest
//! samp.description: how positions in between pixels should be sampled

vec3 last_frame(vec2 pos, int wrap, int samp) {
	pos = pos * 0.5 + 0.5;
	if (wrap == 0)
		pos = clamp(pos, 0.0, 1.0);
	else if (wrap == 1)
		pos = mod(pos, 1.0);
	if (samp == 1)
		pos = floor(0.5 + pos * _texture_size) * (1.0 / _texture_size);
	return texture(_texture, pos).xyz;
}
`,
	`
//! .name: Weighted sum
//! .alt: weighted add
//! .category: math
//! .description: add two numbers or vectors with weights
//! aw.name: a weight
//! aw.default: 1
//! bw.name: b weight
//! bw.default: 1

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} wtadd(${type} a, float aw, ${type} b, float bw) {
	return a * aw + b * bw;
}
`
		).join('\n'),
	`
//! .name: Add
//! .category: math
//! .description: add two numbers or vectors

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} add(${type} a, ${type} b) {
	return a + b;
}
`
		).join('\n'),
	`
//! .name: Subtract
//! .category: math
//! .description: subtract one number or vector from another

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} sub(${type} a, ${type} b) {
	return a - b;
}
`
		).join('\n'),
	`
//! .name: Multiply
//! .category: math
//! .description: multiply two numbers, scale a vector by a number, or perform component-wise multiplication between vectors
` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} mul(${type} a, ${type} b) {
	return a * b;
}
`
		).join('\n'),
	`
//! .name: Divide
//! .category: math
//! .description: divide one number or vector by another
` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} div(${type} a, ${type} b) {
	return a / b;
}
`
		).join('\n'),
	`
//! .name: Power
//! .category: math
//! .id: pow
//! .description: take one number to the power of another
` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} pow_(${type} a, ${type} b) {
	return pow(a, b);
}
`
		).join('\n'),
	`
//! .name: Modulo
//! .category: math
//! .id: mod
//! .description: wrap a value at a certain limit
//! a.name: a
//! b.default: 1
` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} mod_(${type} a, ${type} b) {
	return mod(a, b);
}
`
		).join('\n'),
	`
//! .name: Square
//! .category: geometry
//! .description: select between two inputs depending on whether a point lies within a square (or cube in 3D)
//! pos.name: pos
//! pos.description: point to test
//! pos.default: .pos
//! inside.description: source to use if pos lies inside the square
//! inside.default: #f00
//! outside.description: source to use if pos lies outside the square
//! outside.default: #0f0
//! size.description: radius of the square
//! size.default: 0.5

` +
		[
			['float', 'a'],
			['vec2', 'max(a.x, a.y)'],
			['vec3', 'max(a.x, max(a.y, a.z))'],
			['vec4', 'max(max(a.x, a.y), max(a.z, a.w))'],
		]
			.map((x) => {
				const type = x[0];
				const max = x[1];
				return ['float', 'vec2', 'vec3', 'vec4']
					.map(
						(type2) => `
${type2} square(${type} pos, ${type2} inside, ${type2} outside, ${type} size) {
	${type} a = abs(pos) / size;
	return ${max} < 1.0 ? inside : outside;
}
`
					)
					.join('\n');
			})
			.join('\n'),
	`
//! .name: Circle
//! .category: geometry
//! .description: select between two inputs depending on whether a point lies within a circle (or sphere in 3D)
//! pos.default: .pos
//! pos.description: point to test
//! inside.default: #f00
//! inside.description: source to use if pos lies inside the circle
//! outside.default: #0f0
//! outside.description: source to use if pos lies outside the circle
//! size.default: 0.5
//! size.description: radius of the circle

` +
		GLSL_FLOAT_TYPE_PAIRS.map(
			([type, type2]) => `
${type2} circle(${type} pos, ${type2} inside, ${type2} outside, ${type} size) {
	pos /= size;
	return dot(pos, pos) < 1.0 ? inside : outside;
}
`
		).join('\n'),
	`
//! .name: Comparator
//! .category: basic
//! .description: select between two inputs depending on a comparison between two values
//! .id: cmp
//! cmp1.name: compare 1
//! cmp1.description: input to compare against "Compare 2"
//! cmp2.name: compare 2
//! cmp2.default: 0
//! cmp2.description: input to compare against "Compare 1"
//! less.name: if less
//! less.default: 0
//! less.description: value to output if "Compare 1" < "Compare 2"
//! greater.name: if greater
//! greater.default: 1
//! greater.description: value to output if "Compare 1" ≥ "Compare 2"
` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} compare(float cmp1, float cmp2, ${type} less, ${type} greater) {
	return cmp1 < cmp2 ? less : greater;
}
`
		).join('\n'),
	`
//! .name: Sine wave
//! .category: curves
//! .description: sine, triangle, square, sawtooth waves
//! .id: sin
//! type.control: select:sin|tri|squ|saw
//! t.description: position in the wave
//! t.default: .time
//! period.description: period of the wave
//! period.default: 1
//! amp.name: amplitude
//! amp.default: 1
//! amp.description: amplitude (maximum value) of the wave
//! phase.default: 0
//! phase.description: phase of the wave (0.5 = phase by ½ period)
//! center.name: baseline
//! center.default: 0
//! center.description: this value is added to the output at the end
//! nonneg.name: non-negative
//! nonneg.description: make the wave go from baseline to baseline+amp, rather than baseline-amp to baseline+amp
//! nonneg.control: checkbox

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} sine_wave(int type, ${type} t, ${type} period, ${type} amp, ${type} phase, ${type} center, int nonneg) {
	${type} v = ${type}(0.0);
	t = t / period - phase;
	if (type == 0) {
		v = sin(t * 6.2831853);
	} else if (type == 1) {
		t = mod(t, 1.0);
		${type} s = step(${type}(0.5), t);
		v = mix(4.0 * t - 1.0, 3.0 - 4.0 * t, s);
	} else if (type == 2) {
		v = mod(floor(2.0 * t) + 1.0, 2.0) * 2.0 - 1.0;
	} else if (type == 3) {
		v = mod(t, 1.0) * 2.0 - 1.0;
	}
	if (nonneg != 0) v = v * 0.5 + 0.5;
	return amp * v + center;
}
`
		).join('\n'),
	`
//! .name: Rotate 2D
//! .category: geometry
//! .id: rot2
//! .description: rotate a 2-dimensional vector
//! v.description: vector to rotate
//! theta.name: θ
//! theta.description: angle to rotate by (in radians)
//! dir.name: direction
//! dir.description: direction of rotation
//! dir.control: select:CCW|CW

vec2 rotate2D(vec2 v, float theta, int dir) {
	if (dir == 1) theta = -theta;
	float c = cos(theta), s = sin(theta);
	return vec2(c*v.x - s*v.y, s*v.x + c*v.y);
}
`,
	`
//! .name: Hue shift
//! .category: colors
//! .id: hue
//! .description: shift hue of color
//! color.description: input color
//! shift.description: how much to shift hue by (0.5 = shift halfway across the rainbow)

vec3 hue_shift(vec3 color, float shift) {
	vec3 c = color;
	// rgb to hsv
	vec3 hsv;
	{
		vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
		vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
		vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
		float d = q.x - min(q.w, q.y);
		float e = 1.0e-10;
		hsv = vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
	}
	
	hsv.x = mod(hsv.x + shift, 1.0);
	c = hsv;
	
	// hsv to rgb
	{
		vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
		vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
		return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
	}
}
`,
	`
//! .name: Saturate
//! .category: colors
//! .id: saturate
//! .description: change saturation of color
//! color.description: input color
//! amount.description: how much to change saturation by (−1 to 1 range)

vec3 saturate(vec3 color, float amount) {
	vec3 c = color;
	// rgb to hsv
	vec3 hsv;
	{
		vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
		vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
		vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
		float d = q.x - min(q.w, q.y);
		float e = 1.0e-10;
		hsv = vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
	}
	
	hsv.y = clamp(hsv.y + amount, 0.0, 1.0);
	c = hsv;
	
	// hsv to rgb
	{
		vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
		vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
		return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
	}
}
`,
	`
//! .name: Brightness-contrast
//! .category: colors
//! .description: change brightness/contrast of color
//! color.description: input color
//! brightness.description: how much to change brightness by (−1 to 1 range)
//! contrast.description: how much to change contrast by (−1 to 1 range)

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} brightcont(${type} color, ${type} brightness, ${type} contrast) {
	brightness = clamp(brightness, -1.0, 1.0);
	contrast = clamp(contrast, -1.0, 1.0);
	return clamp((contrast + 1.0) / (1.0 - contrast) * (color - 0.5) + (brightness + 0.5), 0.0, 1.0);
}
`
		).join('\n'),
	`
//! .name: Clamp
//! .category: basic
//! .id: clamp
//! .description: clamp a value between a minimum and maximum
//! x.name: value
//! x.id: val
//! x.description: input value
//! minimum.name: min
//! minimum.id: min
//! maximum.name: max
//! maximum.id: max
` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} clamp_(${type} x, ${type} minimum, ${type} maximum) {
	return clamp(x, minimum, maximum);
}
`
		).join('\n'),
	`
//! .name: Rotate 3D
//! .id: rot3
//! .category: geometry
//! .description: rotate a 3D vector about an axis
//! v.description: the vector to rotate
//! axis.description: the axis to rotate around. the magnitude must be non-zero but otherwise is ignored.
//! axis.default: 0,1,0
//! angle.name: θ
//! angle.description: the angle in radians
//! angle.default: 0.57

vec3 rot3(vec3 v, vec3 axis, float angle) {
	axis = normalize(axis);
	float c = cos(angle);
	float s = sin(angle);
	// https://en.wikipedia.org/wiki/Rodrigues%27_rotation_formula
	return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}
`,
	`
//! .name: Remap
//! .id: remap
//! .category: basic
//! .description: linearly remap a value from one interval to another
//! x.id: x
//! a1.name: a₁
//! a1.default: 0
//! a1.description: negative endpoint of source interval
//! b1.name: b₁
//! b1.default: 1
//! b1.description: positive endpoint of source interval
//! a2.name: a₂
//! a2.default: -1
//! a2.description: positive endpoint of source interval
//! b2.name: b₂
//! b2.default: 1
//! b2.description: positive endpoint of destination interval

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} remap(${type} x, ${type} a1, ${type} b1, ${type} a2, ${type} b2) {
	return (x - a1) / (b1 - a1) * (b2 - a2) + a2;
}
`
		).join('\n'),
	`
//! .name: Smoothstep
//! .id: smoothstep
//! .category: curves
//! .description: smoothly transition between two values (with Hermite interpolation)
//! t.id: t
//! t1.name: t₁
//! t1.description: first input point
//! t1.default: 0
//! t2.name: t₂
//! t2.description: second input point
//! t2.default: 1
//! out1.name: out₁
//! out1.description: output value when t ≤ t₁
//! out1.default: 0
//! out2.name: out₂
//! out2.description: output value when t ≥ t₂
//! out2.default: 1

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} smoothst(${type} t, ${type} t1, ${type} t2, ${type} out1, ${type} out2) {
	return mix(out1, out2, smoothstep(t1, t2, t));
}
`
		).join('\n'),
	`
//! .name: Arctangent
//! .id: arctan2
//! .category: math
//! .description: The arctangent function (radians) with 2 parameters (set x = 1 for normal arctangent)
//! y.id: y
//! x.id: x
//! x.default: 1

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} arctan2(${type} y, ${type} x) {
	return atan(y, x);
}
`
		).join('\n'),
	`
//! .name: Tangent
//! .id: tan
//! .category: math
//! .description: The tangent function (radians)

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} tang(${type} x) {
	return tan(x);
}
`
		).join('\n'),
	`
//! .name: Arcsine
//! .id: arcsin
//! .category: math
//! .description: The arcsine function (radians) — input will be clamped to [−1, 1]

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} arcsin(${type} x) {
	return asin(clamp(x, -1.0, 1.0));
}
`
		).join('\n'),
	`
//! .name: Sigmoid
//! .id: sigmoid
//! .category: curves
//! .description: The sigmoid function — smoothly maps the interval (−∞, ∞) to (a, b)
//! x.description: input value
//! a.description: output value for very negative inputs
//! b.description: output value for very positive inputs
//! sharpness.description: scale factor for input value — higher = quicker transition from a to b

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} sigmoid(${type} x, ${type} a, ${type} b, ${type} sharpness) {
	return mix(a, b, 1.0 / (1.0 + exp(-sharpness * x)));
}
`
		).join('\n'),
	`
//! .name: Staircase (floor)
//! .id: floor
//! .category: curves
//! .description: The floor function — largest integer less than x
//! x.description: input value
//! stepw.name: step w
//! stepw.description: step width
//! steph.name: step h
//! steph.description: step height
//! phase.description: proportion of a step to be added to input
//! phase.default: 0
` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} floorf(${type} x, ${type} stepw, ${type} steph, ${type} phase) {
	return floor(x / stepw + phase) * steph;
}
`
		).join('\n'),
	`
//! .name: Sine noise
//! .category: noise
//! .description: Noise generated from sine waves
//! x.id: x
//! falloff.description: values closer to 0 will emphasize lower-frequency noise, values towards 1 will emphasize higher-frequency noise
//! falloff.default: 0.5
//! freqstep.description: ratio between successive frequencies of noise
//! freqstep.default: 2
//! levels.description: number of frequencies of noises to add together
//! levels.control: int:1|30
//! levels.default: 8

float noise_sin(float x, float falloff, float freqstep, int levels) {
	float k = 1.0;
	float phase = 2.45;
	
	falloff = clamp(falloff, 0.0, 1.0);
	
	float v = 0.0;
	int i = 0;
	for (i = 0; i < levels; i++) {
		float s = sin(x + phase);
		v += k * s * s;
		x *= freqstep;
		k *= falloff;
		phase *= 1.7;
		phase = mod(phase, 6.28);
	}
	return v * (1.0 - falloff);
}

float noise_sin(vec2 x, float falloff, float freqstep, int levels) {
	float v = 0.0;
	float k = 1.0;
	vec2 phase = vec2(1.0, 3.6);
	float theta = 2.7;
	for (int i = 0; i < levels; i++) {
		v += k * abs(sin(x.x + phase.x) * sin(x.y + phase.y));
		phase *= 3.8;
		phase = mod(phase, 6.28);
		x *= freqstep;
		x = mat2(cos(theta), sin(theta), -sin(theta), cos(theta)) * x;
		k *= falloff;
		theta *= 2.4;
		theta = mod(theta, 6.28);
	}
	return v * (1.0 - falloff);
}

float noise_sin(vec3 x, float falloff, float freqstep, int levels) {
	float v = 0.0;
	float k = 1.0;
	vec3 phase = vec3(1.0, 3.6, 2.2);
	float theta = 2.7;
	float phi = 4.6;
	for (int i = 0; i < levels; i++) {
		v += k * abs(sin(x.x + phase.x) * sin(x.y + phase.y) * sin(x.z + phase.z));
		phase *= 4.7;
		phase = mod(phase, 6.28);
		x *= freqstep;
		float ct = cos(theta), st = sin(theta);
		float cp = cos(phi), sp = sin(phi);
		x = mat3(st*cp, ct*cp, -sp, st*sp, ct*sp, cp, ct, -st, 0.0) * x;
		k *= falloff;
		theta *= 2.4;
		theta = mod(theta, 6.28);
	}
	return v * (1.0 - falloff);
}
`,
	`
//! .name: Norm
//! .alt: length/magnitude
//! .description: the Euclidean norm ("length") of a vector
//! .category: geometry

float norm(float x) { return x; }
float norm(vec2 x) { return length(x); }
float norm(vec3 x) { return length(x); }
float norm(vec4 x) { return length(x); }
`,
	`
//! .name: Distance
//! .description: the Euclidean distance between two points
//! .category: geometry

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
float dist(${type} x, ${type} y) { return distance(x, y); }
`
		).join('\n'),
	`
//! .name: Dot product
//! .description: the dot product between two vectors
//! .category: geometry
//! .id: dot

` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
float dot_prod(${type} x, ${type} y) { return dot(x, y); }
`
		).join('\n'),
	`
//! .name: White noise
//! .description: Uniform distribution over [0, 1)
//! .category: noise

float wnoise(float x)
{
	uint k = 134775813u;
	uint u = floatBitsToUint(x) * k;
	u = ((u >> 8) ^ u) * k;
	u = ((u >> 8) ^ u) * k;
	u = ((u >> 8) ^ u) * k;
	return float(u) * (1.0 / 4294967296.0);
}

float wnoise(vec2 x)
{
	uint k = 134775813u;
	uvec2 u = floatBitsToUint(x) * k;
	u = ((u >> 8) ^ u.yx) * k;
	u = ((u >> 8) ^ u.yx) * k;
	u = ((u >> 8) ^ u.yx) * k;
	return float(u) * (1.0 / 4294967296.0);
}

float wnoise(vec3 x)
{
	uint k = 134775813u;
	uvec3 u = floatBitsToUint(x) * k;
	u = ((u >> 8) ^ u.yzx) * k;
	u = ((u >> 8) ^ u.yzx) * k;
	u = ((u >> 8) ^ u.yzx) * k;
	return float(u) * (1.0 / 4294967296.0);
}

float wnoise(vec4 x)
{
	uint k = 134775813u;
	uvec4 u = floatBitsToUint(x) * k;
	u = ((u >> 8) ^ u.yzwx) * k;
	u = ((u >> 8) ^ u.yzwx) * k;
	u = ((u >> 8) ^ u.yzwx) * k;
	return float(u) * (1.0 / 4294967296.0);
}
`,
	`
//! .name: Perlin noise
//! .description: Perlin noise with range [0, 1]
//! .category: noise
//! .require: wnoise
//! x.default: .pos
//! freq.description: input is scaled by this
//! freq.default: 8

float perlin(float x, float freq) {
	x *= freq;
	float grid0 = floor(x);
	float grid1 = grid0 + 1.0;
	
	float d0 = x - grid0;
	float d1 = x - grid1;
	
	float grad0 = wnoise(grid0) < 0.5 ? -1.0 : 1.0;
	float grad1 = wnoise(grid1) < 0.5 ? -1.0 : 1.0;
	
	float n0 = dot(grad0, d0);
	float n1 = dot(grad1, d1);
	
	float s = smoothstep(0.0, 1.0, d0);
	float p = mix(n0, n1, s);
	return p * 0.5 + 0.5;
}

float perlin(vec2 x, vec2 freq) {
	x *= freq;
	vec2 grid00 = floor(x);
	vec2 grid01 = grid00 + vec2(0.0, 1.0);
	vec2 grid10 = grid00 + vec2(1.0, 0.0);
	vec2 grid11 = grid00 + 1.0;
	
	vec2 d00 = x - grid00;
	vec2 d01 = x - grid01;
	vec2 d10 = x - grid10;
	vec2 d11 = x - grid11;
	
	float twopi = 6.2831853;
	float theta00 = wnoise(grid00) * twopi;
	float theta01 = wnoise(grid01) * twopi;
	float theta10 = wnoise(grid10) * twopi;
	float theta11 = wnoise(grid11) * twopi;
	
	vec2 grad00 = vec2(cos(theta00), sin(theta00));
	vec2 grad01 = vec2(cos(theta01), sin(theta01));
	vec2 grad10 = vec2(cos(theta10), sin(theta10));
	vec2 grad11 = vec2(cos(theta11), sin(theta11));
	
	float n00 = dot(grad00, d00);
	float n01 = dot(grad01, d01);
	float n10 = dot(grad10, d10);
	float n11 = dot(grad11, d11);
	
	vec2 s = smoothstep(0.0, 1.0, d00);
	float n0 = mix(n00, n10, s.x);
	float n1 = mix(n01, n11, s.x);
	float p = mix(n0, n1, s.y);
	return p * 0.5 + 0.5;
}

float perlin(vec3 x, vec3 freq) {
	x *= freq;
	vec3 grid000 = floor(x);
	vec3 grid001 = grid000 + vec3(0.0, 0.0, 1.0);
	vec3 grid010 = grid000 + vec3(0.0, 1.0, 0.0);
	vec3 grid011 = grid000 + vec3(0.0, 1.0, 1.0);
	vec3 grid100 = grid000 + vec3(1.0, 0.0, 0.0);
	vec3 grid101 = grid000 + vec3(1.0, 0.0, 1.0);
	vec3 grid110 = grid000 + vec3(1.0, 1.0, 0.0);
	vec3 grid111 = grid000 + vec3(1.0, 1.0, 1.0);
	
	vec3 d000 = x - grid000;
	vec3 d001 = x - grid001;
	vec3 d010 = x - grid010;
	vec3 d011 = x - grid011;
	vec3 d100 = x - grid100;
	vec3 d101 = x - grid101;
	vec3 d110 = x - grid110;
	vec3 d111 = x - grid111;
	
	// thanks to https://math.stackexchange.com/a/1586185
	// this behemoth computes 9 random points on the unit sphere,
	// seeded by grid000–grid111
	float halfpi = 1.5707963;
	float twopi = 6.2831853;
	float a000 = acos(2.0 * wnoise(grid000) - 1.0) - halfpi;
	float a001 = acos(2.0 * wnoise(grid001) - 1.0) - halfpi;
	float a010 = acos(2.0 * wnoise(grid010) - 1.0) - halfpi;
	float a011 = acos(2.0 * wnoise(grid011) - 1.0) - halfpi;
	float a100 = acos(2.0 * wnoise(grid100) - 1.0) - halfpi;
	float a101 = acos(2.0 * wnoise(grid101) - 1.0) - halfpi;
	float a110 = acos(2.0 * wnoise(grid110) - 1.0) - halfpi;
	float a111 = acos(2.0 * wnoise(grid111) - 1.0) - halfpi;
	
	float b000 = twopi * wnoise(vec4(grid000,3.0));
	float b001 = twopi * wnoise(vec4(grid001,3.0));
	float b010 = twopi * wnoise(vec4(grid010,3.0));
	float b011 = twopi * wnoise(vec4(grid011,3.0));
	float b100 = twopi * wnoise(vec4(grid100,3.0));
	float b101 = twopi * wnoise(vec4(grid101,3.0));
	float b110 = twopi * wnoise(vec4(grid110,3.0));
	float b111 = twopi * wnoise(vec4(grid111,3.0));
	
	vec3 grad000 = vec3(cos(a000)*cos(b000), cos(a000)*sin(b000), sin(a000));
	vec3 grad001 = vec3(cos(a001)*cos(b001), cos(a001)*sin(b001), sin(a001));
	vec3 grad010 = vec3(cos(a010)*cos(b010), cos(a010)*sin(b010), sin(a010));
	vec3 grad011 = vec3(cos(a011)*cos(b011), cos(a011)*sin(b011), sin(a011));
	vec3 grad100 = vec3(cos(a100)*cos(b100), cos(a100)*sin(b100), sin(a100));
	vec3 grad101 = vec3(cos(a101)*cos(b101), cos(a101)*sin(b101), sin(a101));
	vec3 grad110 = vec3(cos(a110)*cos(b110), cos(a110)*sin(b110), sin(a110));
	vec3 grad111 = vec3(cos(a111)*cos(b111), cos(a111)*sin(b111), sin(a111));
	
	float n000 = dot(grad000, d000);
	float n001 = dot(grad001, d001);
	float n010 = dot(grad010, d010);
	float n011 = dot(grad011, d011);
	float n100 = dot(grad100, d100);
	float n101 = dot(grad101, d101);
	float n110 = dot(grad110, d110);
	float n111 = dot(grad111, d111);
	
	vec3 s = smoothstep(0.0, 1.0, d000);
	float n00 = mix(n000, n100, s.x);
	float n10 = mix(n010, n110, s.x);
	float n0 = mix(n00, n10, s.y);
	float n01 = mix(n001, n101, s.x);
	float n11 = mix(n011, n111, s.x);
	float n1 = mix(n01, n11, s.y);
	float p = mix(n0, n1, s.z);
	return p * 0.5 + 0.5;
}
`,
	`
//! .name: Worley noise
//! .description: n-dimensional Worley noise
//! .category: noise
//! p.name: x
//! p.id: x
//! p.default: .pos
//! freq.default: 8
//! .require: wnoise

float worley(vec2 p, vec2 freq) {
	p *= freq;
	vec2 f = floor(p);
	float sqd = 1.0;
	for (float dx = -1.0; dx <= +1.0; dx += 1.0) {
		for (float dy = -1.0; dy <= +1.0; dy += 1.0) {
			vec2 g = f + vec2(dx, dy);
			vec2 c = g + vec2(wnoise(g), wnoise(vec3(g, 1.0)));
			sqd = min(sqd, dot(c - p, c - p));
		}
	}
	return sqrt(sqd);
}

float worley(vec3 p, vec3 freq) {
	p *= freq;
	vec3 f = floor(p);
	float sqd = 1.0;
	for (float dx = -1.0; dx <= +1.0; dx += 1.0) {
		for (float dy = -1.0; dy <= +1.0; dy += 1.0) {
			for (float dz = -1.0; dz <= +1.0; dz += 1.0) {
				vec3 g = f + vec3(dx, dy, dz);
				vec3 c = g + vec3(wnoise(g), wnoise(vec4(g, 1.0)), wnoise(vec4(g, 2.0)));
				sqd = min(sqd, dot(c - p, c - p));
			}
		}
	}
	return sqrt(sqd);
}
`,
	`
//! .name: Minimum
//! .description: minimum of two values
//! .category: math
//! .id: min
` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} _min(${type} a, ${type} b) {
	return min(a, b);
}`
		).join('\n'),
	`
//! .name: Maximum
//! .description: maximum of two values
//! .category: math
//! .id: max
` +
		GLSL_FLOAT_TYPES.map(
			(type) => `
${type} _max(${type} a, ${type} b) {
	return max(a, b);
}`
		).join('\n'),
];

function get_creation_title() {
	return creation_title_element.value || 'Untitled';
}

function auto_update_enabled() {
	return auto_update_element.checked;
}

function set_paused(p) {
	paused = p;
	play_element.disabled = !paused;
	pause_element.disabled = paused;
	step_element.disabled = !paused;
}

function restart() {
	current_time = 0;
	update_shader();
	perform_step();
}

function is_input(element) {
	if (!element) return false;
	for (let e = element; e; e = e.parentElement) {
		if (
			e.tagName === 'INPUT' ||
			e.tagName === 'BUTTON' ||
			e.tagName === 'SELECT' ||
			e.isContentEditable
		) {
			return true;
		}
	}
	return false;
}

class Parser {
	constructor(string, line_number) {
		this.string = string;
		this.line_number = line_number;
		this.i = 0;
		this.error = null;
	}

	set_error(e) {
		if (!this.error) this.error = { line: this.line_number, message: e };
	}

	eof() {
		this.skip_space();
		return this.i >= this.string.length;
	}

	has(c) {
		this.skip_space();
		return this.string.substring(this.i, this.i + c.length) === c;
	}

	skip_space() {
		while (this.i < this.string.length && this.string[this.i].match(/\s/)) {
			if (this.string[this.i] === '\n') this.line_number += 1;
			this.i += 1;
		}
	}

	parse_type() {
		this.skip_space();
		const i = this.i;
		for (const type of ['float', 'vec2', 'vec3', 'vec4', 'int']) {
			if (
				this.string.substring(i, i + type.length) === type &&
				this.string[i + type.length] === ' '
			) {
				this.i += type.length + 1;
				return type;
			}
		}
		let end = this.string.indexOf(' ', i);
		if (end === -1) end = this.string.length;
		this.set_error(`no such type: ${this.string.substring(i, end)}`);
	}

	parse_ident() {
		this.skip_space();
		if (this.eof()) {
			this.set_error('expected identifier, got EOF');
			return;
		}
		const first_char = this.string[this.i];
		if (!first_char.match(/[a-zA-Z_]/)) {
			this.set_error(`expected identifier, got '${first_char}'`);
			return;
		}
		const start = this.i;
		this.i += 1;
		while (
			this.i < this.string.length &&
			this.string[this.i].match(/[a-zA-Z0-9_]/)
		) {
			this.i += 1;
		}
		return this.string.substring(start, this.i);
	}

	expect(c) {
		this.skip_space();
		const got = this.string.substring(this.i, this.i + c.length);
		if (got !== c) {
			this.set_error(`expected ${c}, got ${got}`);
		}
		this.i += 1;
	}

	advance() {
		this.i += 1;
	}
}

function control_type(control) {
	if (control.startsWith('select:')) {
		return 'int';
	} else if (control === 'checkbox') {
		return 'int';
	} else if (control === 'slider') {
		return 'float';
	} else if (control.startsWith('int:')) {
		return 'int';
	}
	return null;
}

function parse_widget_definition(code) {
	code = code.trim();
	const params = new Map();
	const info = {
		alt: '',
		params,
		description: '',
		definitions: [],
		require: [],
	};
	let lines = code.split('\n');
	let def_start = undefined;
	let error = undefined;
	const param_regex = /^[a-zA-Z_][a-zA-Z0-9_]*/gu;

	lines.forEach((line, index) => {
		if (error) return;
		if (def_start !== undefined) return;

		line = line.trim();
		if (line.startsWith('//! ')) {
			const parts = line.substring('//! '.length).split(': ');
			if (parts.length !== 2) {
				error = `on line ${index + 1}: line must contain ": " exactly once`;
				return;
			}
			const key = parts[0].trim();
			const value = parts[1].trim();
			if (key === '.name') {
				info.name = value;
			} else if (key === '.description') {
				info.description = value;
			} else if (key === '.id') {
				info.id = value;
			} else if (key === '.category') {
				info.category = value;
			} else if (key === '.alt') {
				info.alt = value;
			} else if (key === '.require') {
				for (const r of value.split(',')) {
					info.require.push(r.trim());
				}
			} else if (key.startsWith('.')) {
				error = `on line ${index + 1}: key ${key} not recognized`;
				return;
			} else {
				const key_parts = key.split('.');
				if (key_parts.length !== 2) {
					error = `on line ${
						index + 1
					}: expected key to be of form parameter.property, got ${key}`;
					return;
				}
				const param_name = key_parts[0];
				const property = key_parts[1];
				if (!param_name.match(param_regex)) {
					error = `on line ${index + 1}: bad parameter name: ${param_name}`;
				}
				if (!params.has(param_name)) {
					params.set(param_name, {});
				}
				const param = params.get(param_name);
				switch (property) {
					case 'id':
					case 'name':
					case 'description':
					case 'default':
					case 'control':
						param[property] = value;
						break;
					default:
						error = `on line ${
							index + 1
						}: parameter property '${property}' not recognized`;
						return;
				}
			}
		} else if (line.startsWith('//!')) {
			error = `on line ${index + 1}: missing space after //!`;
		} else if (line.startsWith('//')) {
			// comment
		} else {
			def_start = index;
			return;
		}
	});
	if (error) {
		return { error };
	}
	lines = lines.slice(def_start);
	if (lines.some((x) => x.startsWith('//!'))) {
		return { error: '//! appears after first function definition' };
	}
	lines = lines.map((x) => {
		x = x.trim();
		if (x.startsWith('//')) {
			return '';
		}
		return x;
	});

	const parser = new Parser(lines.join('\n'), def_start + 1);
	while (!parser.error && !parser.eof()) {
		const definition_start = parser.i;
		const return_type = parser.parse_type();
		const fname = parser.parse_ident();
		if (!info.function_name) info.function_name = fname;
		if (!parser.error && fname !== info.function_name) {
			return {
				error: `function defined as both '${info.function_name}' and '${fname}'`,
			};
		}
		if (!info.id) info.id = info.function_name;

		const definition_params = [];
		parser.expect('(');
		while (!parser.eof() && !parser.has(')')) {
			if (parser.has(',')) parser.expect(',');
			const type = parser.parse_type();
			const name = parser.parse_ident();
			definition_params.push({ type, name });

			if (!params.has(name)) {
				if (!info.definitions.size) {
					params.set(name, {});
				} else if (!parser.error) {
					return { error: `parameter ${name} does not exist` };
				}
			}
		}

		// we have all parameters now — fill out missing fields
		if (!info.definitions.size) {
			for (const param_name of params.keys()) {
				const param = params.get(param_name);
				if (!param.id) param.id = param_name;
				if (!param.name) param.name = param.id;
				if (!param.description) param.description = '';
			}
		}

		const input_types = new Map();
		const param_order = new Map();
		definition_params.forEach((p, index) => {
			const param = params.get(p.name);
			if (param.control) {
				const expected_type = control_type(param.control);
				if (!expected_type) {
					parser.set_error(`bad control type: '${param.control}'`);
				}
				if (p.type !== expected_type) {
					parser.set_error(
						`parameter ${p.name} should have type ${expected_type} since it's a ${param.control}, but it has type ${p.type}`
					);
				}
			}

			if (!param.control && p.type === 'int') {
				parser.set_error(
					`parameter ${p.name} has type int, so you should set a control type for it, e.g. //! ${p.name}.control: checkbox`
				);
			}
			if (!param.control) {
				input_types.set(param.id, p.type);
			}
			param_order.set(param.id, index);
		});
		for (const param of params.values()) {
			if (!input_types.has(param.id) && !param.control) {
				parser.set_error(
					`parameter ${param.id} not specified in definition of ${info.function_name}`
				);
			}
		}

		parser.expect(')');
		parser.expect('{');
		let brace_depth = 1;
		while (!parser.eof() && brace_depth > 0) {
			if (parser.has('{')) brace_depth += 1;
			if (parser.has('}')) brace_depth -= 1;
			parser.advance();
		}
		const definition_end = parser.i;
		const definition = parser.string.substring(
			definition_start,
			definition_end
		);
		info.definitions.push({
			input_types,
			param_order,
			return_type,
			code: definition,
		});
	}
	if (parser.error) {
		const err = parser.error;
		return { error: `on line ${err.line}: ${err.message}` };
	}
	if (!info.name) info.name = info.id;
	if (!info.category) {
		return { error: `no category set for ${info.id}` };
	}
	return info;
}

const widget_info = new Map();
for (const code of builtin_widgets) {
	const result = parse_widget_definition(code);
	if (result && result.error) {
		console.error(result.error);
	} else {
		widget_info.set(result.id, result);
	}
}

window.addEventListener('load', startup);

function set_ui_shown(to) {
	ui_shown = to;
	const ui_viz = to ? 'visible' : 'collapse';
	ui_div.style.visibility = ui_viz;
	ui_resize.style.visibility = ui_viz;
}

function color_hex_to_float(hex) {
	let r;
	let g;
	let b;
	let a;

	hex = hex.trim();

	if (!hex || hex[0] !== '#') return null;

	if (hex.length === 7 || hex.length === 9) {
		// #rrggbb or #rrggbbaa
		r = parseInt(hex.substring(1, 3), 16) / 255;
		g = parseInt(hex.substring(3, 5), 16) / 255;
		b = parseInt(hex.substring(5, 7), 16) / 255;
		a = hex.length === 7 ? 1 : parseInt(hex.substring(7, 9), 16) / 255;
	} else if (hex.length === 4 || hex.length === 5) {
		// #rgb or #rgba
		r = parseInt(hex[1], 16) / 15;
		g = parseInt(hex[2], 16) / 15;
		b = parseInt(hex[3], 16) / 15;
		a = hex.length === 4 ? 1 : parseInt(hex[4], 16) / 15;
	}

	if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) {
		return null;
	}

	const color = {
		r: r,
		g: g,
		b: b,
		a: a,
	};
	Object.preventExtensions(color);
	return color;
}

function color_float_to_hex(color) {
	const r = Math.round(color.r * 255);
	const g = Math.round(color.g * 255);
	const b = Math.round(color.b * 255);
	const a = Math.round((color.a ?? 1) * 255);
	function component(x) {
		x = x.toString(16);
		while (x.length < 2) x = '0' + x;
		return x;
	}
	let ca = component(a);
	if (ca === 'ff') ca = '';
	return `#${component(r)}${component(g)}${component(b)}${ca}`;
}

function update_shader() {
	clear_error();
	const source = get_shader_source();
	if (source === null) {
		return;
	}
	const fragment_code = `#version 300 es

#ifdef GL_ES
precision highp float;
#endif

uniform sampler2D _texture;
uniform float _time;
uniform vec2 _mouse;
uniform vec2 _texture_size;
in vec2 _pos;
out vec4 _out_color;

${source}

void main() {
	_out_color = vec4(_get_color(), 1.0);
}
`;
	const vertex_code = `#version 300 es
in vec2 v_pos;
out vec2 _pos;
void main() {
	_pos = v_pos;
	gl_Position = vec4(v_pos, 0.0, 1.0);
}
`;
	program_main = compile_program('main', {
		vertex: vertex_code,
		fragment: fragment_code,
	});
}

function on_key_press(e) {
	if (is_input(e.target)) {
		return;
	}
	switch (e.key) {
		case ' ':
			set_paused(!paused);
			break;
		case '.':
			perform_step();
			break;
		case 'Tab':
			set_ui_shown(!ui_shown);
			e.preventDefault();
			break;
		case 'r':
			restart();
			break;
	}
}

function float_glsl(f) {
	if (isNaN(f)) return '(0.0 / 0.0)';
	if (f === Infinity) return '1e+1000';
	if (f === -Infinity) return '-1e+1000';
	const s = f + '';
	if (s.indexOf('.') !== -1 || s.indexOf('e') !== -1) return s;
	return s + '.0';
}

function type_component_count(type) {
	switch (type) {
		case 'float':
			return 1;
		case 'vec2':
			return 2;
		case 'vec3':
			return 3;
		case 'vec4':
			return 4;
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
				case 1:
					return 'float';
				case 2:
					return 'vec2';
				case 3:
					return 'vec3';
				case 4:
					return 'vec4';
				default:
					return null;
			}
		default:
			return null;
	}
}

function get_widget_by_name(name) {
	for (const w of document.getElementsByClassName('widget')) {
		if (get_widget_name(w) === name) {
			return w;
		}
	}
	return null;
}

function get_widget_by_id(id) {
	return document.querySelector(`.widget[data-id="${id}"]`);
}

function get_widget_name(widget_div) {
	const names = widget_div.getElementsByClassName('widget-name');
	console.assert(
		names.length === 1,
		'there should be exactly one widget-name input per widget'
	);
	return names[0].innerText;
}

function get_widget_names() {
	const s = new Set();
	for (const w of document.getElementsByClassName('widget-name')) {
		s.add(w.innerText);
	}
	return s;
}

function set_display_output_and_update_shader(to) {
	for (const widget of document.querySelectorAll('.widget[data-display="1"]')) {
		widget.dataset.display = '0';
	}
	if (to) {
		to.dataset.display = '1';
	}
	update_shader();
}

function update_input_element(input_element) {
	const container = input_element.parentElement;

	{
		// add color input if the text is a color
		let color_input = container.querySelector('input[type="color"]');
		const color_value = color_hex_to_float(input_element.innerText);
		if (color_value) {
			if (!color_input) {
				color_input = document.createElement('input');
				color_input.type = 'color';
				color_input.addEventListener('input', () => {
					// this is kinda complicated because we
					// want to preserve whether or not there's an alpha channel
					// (but input[type=color] doesn't support alpha)
					const prev_value = input_element.innerText;
					const color = color_hex_to_float(color_input.value);
					color.a = color_hex_to_float(prev_value).a;
					const specify_alpha =
						prev_value.length === 5 || prev_value.length === 9;
					let new_value = color_float_to_hex(color);
					console.assert(new_value.length === 7 || new_value.length === 9);
					if (specify_alpha) {
						if (new_value.length === 7) new_value += 'ff';
					} else {
						new_value = new_value.slice(0, 7);
					}
					input_element.innerText = new_value;
					if (auto_update_enabled()) update_shader();
				});
				container.appendChild(color_input);
			}
			// if a color input has already been created for this input,
			// we just need to update its value and show it.
			color_input.value = color_float_to_hex({
				r: color_value.r,
				g: color_value.g,
				b: color_value.b,
			}).slice(0, 7);
			color_input.style.display = 'inline-block';
		} else {
			if (color_input) {
				color_input.style.display = 'none';
			}
		}
	}
}

let dragging_widget = null;
window.addEventListener('mouseup', () => {
	dragging_widget = null;
	const element = document.querySelector('.widget.dragging');
	if (element) element.classList.remove('dragging');
});

function add_widget(func) {
	const info = widget_info.get(func);
	console.assert(info !== undefined, 'bad widget ID: ' + func);
	const root = document.createElement('div');
	root.dataset.func = func;
	root.dataset.id = next_widget_id++;
	root.classList.add('widget');
	root.addEventListener('mouseover', () => {
		if (!dragging_widget) return;

		switch (root.compareDocumentPosition(dragging_widget)) {
			case Node.DOCUMENT_POSITION_DISCONNECTED:
			case Node.DOCUMENT_POSITION_CONTAINS:
			case Node.DOCUMENT_POSITION_CONTAINED_BY:
				console.error('unexpected compareDocumentPosition return value');
				break;
			case Node.DOCUMENT_POSITION_PRECEDING:
				// dragging up
				dragging_widget.before(root);
				break;
			case Node.DOCUMENT_POSITION_FOLLOWING:
				// dragging down
				dragging_widget.after(root);
				break;
		}
	});

	{
		// delete button
		const delete_button = document.createElement('button');
		delete_button.ariaLabel = 'delete';
		delete_button.classList.add('widget-delete');
		delete_button.classList.add('widget-button');
		delete_button.addEventListener('click', () => {
			root.remove();
			update_shader();
		});
		root.appendChild(delete_button);
	}

	{
		// move button
		const move_button = document.createElement('button');
		move_button.ariaLabel = 'move';
		move_button.classList.add('widget-move');
		move_button.classList.add('widget-button');
		move_button.addEventListener('mousedown', () => {
			dragging_widget = root;
			root.classList.add('dragging');
		});
		root.appendChild(move_button);
	}

	{
		// title
		const title = document.createElement('div');
		title.classList.add('widget-title');
		if (info.description) {
			title.title = info.description;
		}
		const type = document.createElement('span');
		type.classList.add('widget-type');
		type.appendChild(document.createTextNode(info.name));
		type.addEventListener('click', (e) => {
			set_display_output_and_update_shader(root);
			e.preventDefault();
		});

		title.appendChild(type);
		title.appendChild(document.createTextNode(' '));

		const name_input = document.createElement('div');
		name_input.contentEditable = true;
		name_input.spellcheck = false;
		name_input.classList.add('widget-name');
		name_input.addEventListener('input', () => update_shader());

		// generate unique name
		const names = get_widget_names();
		let i;
		for (i = 1; ; i++) {
			if (!names.has(func + i)) {
				break;
			}
		}
		name_input.innerText = func + i;

		title.appendChild(name_input);
		root.appendChild(title);
	}

	// parameters
	for (const param of info.params.values()) {
		if (param.control) {
			// control
			const container = document.createElement('div');
			container.classList.add('control');
			container.dataset.id = param.id;
			const type = param.control;
			let input;
			if (type === 'checkbox') {
				input = document.createElement('input');
				input.classList.add('entry');
				input.type = 'checkbox';
				if (param['default']) {
					input.checked = 'checked';
				}
			} else if (type.startsWith('select:')) {
				const options = type.substring('select:'.length).split('|');

				input = document.createElement('select');
				input.classList.add('entry');
				for (const opt of options) {
					const option = document.createElement('option');
					option.appendChild(document.createTextNode(opt));
					option.value = opt;
					input.appendChild(option);
				}

				if (param['default']) {
					input.value = param['default'];
				}
			} else if (type === 'slider') {
				input = document.createElement('input');
				input.classList.add('entry');
				input.type = 'range';
				input.min = 0;
				input.max = 1;
				input.step = 0.001;
				input.value = 0;
				const update_title = () => {
					input.title = '' + input.value;
				};
				input.addEventListener('mouseover', update_title);
				input.addEventListener('input', update_title);
				if (param['default']) {
					input.value = param['default'];
				}
			} else if (type.startsWith('int:')) {
				const range = type.substring('int:'.length).split('|');
				console.assert(range.length === 2, 'bad format for int control');
				const [min, max] = range;
				input = document.createElement('input');
				input.dataset.isInt = true;
				input.classList.add('entry');
				input.type = 'number';
				input.min = min;
				input.max = max;
				input.step = 1;
				input.value = Math.round((min + max) / 2);
				if (param['default']) {
					input.value = param['default'];
				}
			} else {
				console.error('bad control type');
			}

			input.id = 'gen-control-' + next_html_id++;
			input.classList.add('control-input');
			const label = document.createElement('label');
			label.htmlFor = input.id;
			label.appendChild(document.createTextNode(param.name));
			if (param.description) {
				container.title = param.description;
			}
			container.appendChild(label);
			container.appendChild(document.createTextNode('='));
			container.appendChild(input);
			root.appendChild(container);
			root.appendChild(document.createTextNode(' '));
		} else {
			// input
			const container = document.createElement('div');
			container.classList.add('in');
			container.dataset.id = param.id;
			// input_wrapper is a workaround for firefox bug
			//   https://bugzilla.mozilla.org/show_bug.cgi?id=1248186
			const input_wrapper = document.createElement('div');
			input_wrapper.classList.add('inline-block');
			const input_element = document.createElement('div');
			input_element.contentEditable = true;
			input_element.spellcheck = false;
			input_element.addEventListener('keydown', (e) => {
				if (e.keyCode === 13) {
					input_element.blur();
					e.preventDefault();
				}
			});
			input_element.classList.add('entry');
			input_element.appendChild(document.createElement('br'));
			input_element.type = 'text';
			input_element.id = 'gen-input-' + next_html_id++;
			input_wrapper.appendChild(input_element);

			const label = document.createElement('label');
			label.htmlFor = input_element.id;
			if (param.description) {
				container.title = param.description;
			}
			if (param['default']) {
				input_element.innerText = param['default'];
			}
			label.appendChild(document.createTextNode(param.name));
			container.appendChild(label);
			container.appendChild(document.createTextNode('='));
			container.appendChild(input_wrapper);
			root.appendChild(container);
			root.appendChild(document.createTextNode(' '));

			input_element.addEventListener('input', () => {
				update_input_element(input_element);
				if (auto_update_enabled()) {
					update_shader();
				}
			});
			update_input_element(input_element);
		}
	}

	widgets_container.appendChild(root);
	return root;
}

class GLSLGenerationState {
	constructor(widgets) {
		this.widgets = widgets;
		this.declarations = new Set();
		this.code = [];
		this.computing_inputs = new Set();
		this.variable = 0;
	}

	next_variable() {
		this.variable += 1;
		return 'v' + this.variable;
	}

	add_code(code) {
		this.code.push(code);
	}

	get_code() {
		return `
${Array.from(this.declarations).join('')}
vec3 _get_color() {
${this.code.join('')}
}`;
	}

	compute_input(input) {
		input = input.trim();
		if (input.length === 0) {
			return { error: 'empty input' };
		}
		if (!isNaN(input)) {
			return { code: float_glsl(parseFloat(input)), type: 'float' };
		}

		if (input.indexOf(',') !== -1) {
			// vector construction
			const items = input.split(',');
			console.assert(items.length >= 2, 'huhhhhh??');
			const components = [];
			for (const item of items) {
				const component = this.compute_input(item);
				if ('error' in component) {
					return component;
				}
				components.push(component);
			}
			let component_count = 0;
			let base_type = undefined;
			for (const component of components) {
				const type = component.type;
				const c = type_component_count(type);
				if (c === 0) {
					return { error: `cannot use type ${type} with ,` };
				}
				component_count += c;
				if (base_type === undefined) {
					base_type = type_base_type(type);
				}
				if (base_type !== type_base_type(type)) {
					return { error: 'bad combination of types for ,' };
				}
			}
			const type = type_vec(base_type, component_count);
			if (type === null) {
				// e.g. trying to combine 5 floats
				return { error: 'bad combination of types for ,' };
			}
			const v = this.next_variable();
			const component_values = components.map((c) => c.code);
			this.add_code(`${type} ${v} = ${type}(${component_values.join()});\n`);
			return { type: type, code: v };
		}

		if (input[0] === '#') {
			const color = color_hex_to_float(input);
			if (color === null) {
				return { error: 'bad color: ' + input };
			}
			return input.length === 4 || input.length === 7
				? {
						code: `vec3(${float_glsl(color.r)},${float_glsl(
							color.g
						)},${float_glsl(color.b)})`,
						type: 'vec3',
				  }
				: {
						code: `vec4(${float_glsl(color.r)},${float_glsl(
							color.g
						)},${float_glsl(color.b)},${float_glsl(color.a)})`,
						type: 'vec4',
				  };
		}

		const dot = input.lastIndexOf('.');
		if (dot === input.length - 1) {
			return { error: 'inputs should not end in .' };
		}

		if (dot === 0) {
			switch (input) {
				case '.pos':
					return { code: '_pos', type: 'vec2' };
				case '.pos01':
					return { code: '(0.5+0.5*_pos)', type: 'vec2' };
				case '.time':
					return { code: '_time', type: 'float' };
				case '.mouse':
					return { code: '_mouse', type: 'vec2' };
				case '.mouse01':
					return { code: '(0.5+0.5*_mouse)', type: 'vec2' };
				case '.π':
				case '.pi':
					return { code: '(3.1415927)', type: 'float' };
				case '.2π':
				case '.2pi':
					return { code: '(6.2831853)', type: 'float' };
				default:
					return { error: `no such builtin: ${input}` };
			}
		}

		const field = dot === -1 ? '' : input.substring(dot + 1);

		if (
			field.length >= 1 &&
			field.length <= 4 &&
			field.split('').every((c) => 'xyzw'.indexOf(c) !== -1)
		) {
			// swizzle
			const vector = this.compute_input(input.substring(0, dot));
			if ('error' in vector) {
				return { error: vector.error };
			}
			const base = type_base_type(vector.type);
			const count = type_component_count(vector.type);

			for (const c of field) {
				const i = 'xyzw'.indexOf(c);
				if (i >= count) {
					return { error: `type ${vector.type} has no field ${c}.` };
				}
			}

			return {
				code: `(${vector.code}).${field}`,
				type: type_vec(base, field.length),
			};
		} else if (field) {
			return { error: `no such field: ${field}` };
		}

		const widget = this.widgets.get(input);
		if (widget === undefined) {
			return { error: `cannot find widget '${input}'` };
		}

		if (this.computing_inputs.has(input)) {
			return { error: 'circular dependency at ' + input };
		}
		this.computing_inputs.add(input);
		const value = this.compute_widget_output(widget);
		if (value.error) {
			if (!value.widget) {
				value.widget = widget.id;
			}
			return value;
		}
		this.computing_inputs.delete(input);
		return value;
	}

	add_requirements_of(widget) {
		for (const req_name of widget.require) {
			const req = widget_info.get(req_name);
			console.assert(req, 'bad widget requirement:', req_name);
			const size0 = this.declarations.size;
			for (const def of req.definitions) {
				this.declarations.add(def.code);
			}
			if (this.declarations.size !== size0) {
				this.add_requirements_of(req);
			}
		}
	}

	compute_widget_output(widget) {
		if (widget.output) return widget.output;

		const info = widget_info.get(widget.func);
		this.add_requirements_of(info);
		console.assert(info, 'bad widget func');
		const args = new Map();
		const input_types = new Map();
		for (let [input, value] of widget.inputs) {
			value = this.compute_input(value);
			if (value.error) {
				widget.output = value;
				return value;
			}
			args.set(input, value.code);
			input_types.set(input, value.type);
		}
		for (const control of widget.controls) {
			args.set(control.id, control.uniform);
		}

		let best_definition = undefined;
		let best_score = -Infinity;
		for (const definition of info.definitions) {
			if (definition.input_types.length !== input_types.length) continue;
			if (definition.param_order.length !== args.length) continue;
			let score = 0;
			for (const [input_name, input_type] of definition.input_types) {
				const got_type = input_types.get(input_name);
				if (got_type === input_type) {
					score += 1;
				} else if (got_type === 'float') {
					// implicit conversion
				} else {
					score = -Infinity;
				}
			}
			if (score > best_score) {
				best_definition = definition;
				best_score = score;
			}
		}

		if (!best_definition) {
			const s = [];
			for (const [n, t] of input_types) {
				s.push(`${n}:${t}`);
			}
			return { error: `bad types for ${info.name}: ${s.join(', ')}` };
		}

		const output_var = this.next_variable();
		const definition = best_definition;
		const args_code = new Array(args.length);
		for (let [arg_name, arg_code] of args) {
			if (definition.input_types.has(arg_name)) {
				const expected_type = definition.input_types.get(arg_name);
				const got_type = input_types.get(arg_name);
				if (got_type !== expected_type) {
					arg_code = `${expected_type}(${arg_code})`;
				}
			}
			args_code[definition.param_order.get(arg_name)] = arg_code;
		}
		const type = definition.return_type;
		this.declarations.add(definition.code);
		this.add_code(
			`${type} ${output_var} = ${info.function_name}(${args_code.join(',')});\n`
		);
		widget.output = {
			code: output_var,
			type,
		};
		return widget.output;
	}
}

function parse_widgets() {
	const widgets = new Map();
	for (const widget_div of document.getElementsByClassName('widget')) {
		const name = get_widget_name(widget_div);
		const func = widget_div.dataset.func;
		const widget_id = parseInt(widget_div.dataset.id);
		if (!name) {
			return {
				error: 'widget has no name. please give it one.',
				widget: widget_id,
			};
		}
		for (const c of name) {
			if ('.,;|/\\:(){}[]+-<>\'"`~?!#%^&*'.indexOf(c) !== -1) {
				return {
					error: `widget name cannot contain the character ${c}`,
					widget: widget_id,
				};
			}
		}
		if (widgets.has(name)) {
			return { error: `duplicate widget name: ${name}`, widget: widget_id };
		}

		const inputs = new Map();
		const controls = [];
		for (const input of widget_div.getElementsByClassName('in')) {
			const input_id = input.dataset.id;
			inputs.set(input_id, input.getElementsByClassName('entry')[0].innerText);
		}
		for (const control of widget_div.getElementsByClassName('control')) {
			const control_id = control.dataset.id;
			controls.push({
				id: control_id,
				uniform: `_control${widget_id}_${control_id}`,
				type: get_control_value(widget_id, control_id).type,
			});
		}
		widgets.set(name, {
			func,
			id: widget_id,
			inputs,
			controls,
		});
	}
	parsed_widgets = widgets;
	return widgets;
}

function get_control_value(widget_id, control_id) {
	const widget = get_widget_by_id(widget_id);
	const control = widget.querySelector(`.control[data-id="${control_id}"]`);
	const input = control.querySelector('.control-input');
	if (input.tagName === 'INPUT' && input.type === 'checkbox') {
		return {
			type: 'int',
			value: input.checked ? 1 : 0,
		};
	} else if (input.tagName === 'INPUT') {
		if (input.dataset.isInt) {
			return {
				type: 'int',
				value: parseInt(input.value),
			};
		} else {
			return {
				type: 'float',
				value: parseFloat(input.value),
			};
		}
	} else if (input.tagName === 'SELECT') {
		return {
			type: 'int',
			value: Array.from(input.getElementsByTagName('option'))
				.map((o) => o.value)
				.indexOf(input.value),
		};
	} else {
		console.error(`unrecognized control tag: ${input.tagName}`);
	}
}

function export_widgets() {
	const widgets = parse_widgets();
	if (widgets.error) {
		show_error(widgets);
		return;
	}
	console.assert(widgets instanceof Map);
	const data = ['_title=', get_creation_title(), ';;'];
	for (const [name, widget] of widgets) {
		data.push(widget.func);
		data.push(';');
		data.push('n:');
		data.push(name);
		data.push(';');
		for (const [input, value] of widget.inputs) {
			data.push('i');
			data.push(input);
			data.push(':');
			data.push(value);
			data.push(';');
		}
		for (const control of widget.controls) {
			data.push('c');
			data.push(control.id);
			data.push(':');
			data.push(get_control_value(widget.id, control.id).value);
			data.push(';');
		}
		data.pop(); // remove terminal separator
		data.push(';;');
	}
	data.push('_out=');
	data.push(
		get_widget_name(document.querySelector('.widget[data-display="1"]'))
	);
	return data.join('');
}

function import_widgets(string) {
	let widgets = [];
	let output = null;
	let title = null;
	if (string) {
		for (const widget_str of string.split(';;')) {
			if (widget_str.startsWith('_out=')) {
				output = widget_str.substring('_out='.length);
				continue;
			}
			if (widget_str.startsWith('_title=')) {
				title = widget_str.substring('_title='.length);
				continue;
			}

			const parts = widget_str.split(';');
			const func = parts[0];
			const widget = {
				name: null,
				func,
				inputs: new Map(),
				controls: new Map(),
			};
			parts.splice(0, 1);
			for (const part of parts) {
				const kv = part.split(':');
				if (kv.length !== 2) {
					return { error: `bad key-value pair (kv count ${kv.length})` };
				}
				const type = kv[0][0];
				const key = kv[0].substring(1);
				const value = kv[1];
				if (type === 'n') {
					// name
					widget.name = value;
				} else if (type === 'i') {
					// input
					widget.inputs.set(key, value);
				} else if (type === 'c') {
					// control
					widget.controls.set(key, value);
				} else {
					return { error: `bad widget part type: '${type}'` };
				}
			}

			if (widget.name === null) {
				return { error: 'widget has no name' };
			}
			widgets.push(widget);
		}
	} else {
		widgets = [
			{
				name: 'output',
				func: 'buffer',
				inputs: new Map([['input', '#acabff']]),
				controls: new Map(),
			},
		];
		output = 'output';
	}

	creation_title_element.value = title || 'Untitled';

	function assign_value(container, value) {
		const element = container.getElementsByClassName('entry')[0];
		if (!element) {
			console.error('container', container, 'has no input entry');
		} else if (element.type === 'checkbox') {
			element.checked = value === 'true' || value === '1' ? 'checked' : '';
		} else if (element.tagName === 'INPUT') {
			element.value = value;
		} else if (element.tagName === 'SELECT') {
			const options = Array.from(element.getElementsByTagName('option')).map(
				(o) => o.value
			);
			if (value >= 0 && value < options.length) {
				element.value = options[value];
			} else if (options.indexOf(value) !== -1) {
				element.value = value;
			} else {
				return { error: `bad import string (unrecognized value ${value})` };
			}
		} else if (element.tagName === 'DIV') {
			element.innerText = value;
			update_input_element(element);
		} else {
			console.error('bad element', element);
		}
	}
	widgets_container.innerHTML = '';
	for (const widget of widgets) {
		const name = widget.name;
		if (!widget_info.has(widget.func)) {
			return {
				error: `bad import string (widget type '${widget.func}' does not exist)`,
			};
		}
		const element = add_widget(widget.func);
		element.getElementsByClassName('widget-name')[0].innerText = name;

		for (const [input, value] of widget.inputs) {
			const container = Array.from(element.getElementsByClassName('in')).find(
				(e) => e.dataset.id === input
			);
			if (!container) {
				return { error: `bad import string (input ${input} does not exist)` };
			}
			assign_value(container, value);
		}
		for (const [control, value] of widget.controls) {
			const container = Array.from(
				element.getElementsByClassName('control')
			).find((e) => e.dataset.id === control);
			if (!container) {
				return {
					error: `bad import string (control ${control} does not exist)`,
				};
			}
			assign_value(container, value);
		}
	}

	set_display_output_and_update_shader(get_widget_by_name(output));
	return true;
}

function export_widgets_to_local_storage() {
	const widget_str = export_widgets();
	code_input.value = widget_str;
	localStorage.setItem(`${APP_ID}-${creation_id}-description`, widget_str);
	creation_metadata[creation_id] = {
		lastViewed: Date.now(),
		title: get_creation_title(),
	};
	localStorage.setItem(`${APP_ID}-metadata`, JSON.stringify(creation_metadata));
}

function load_creation(id) {
	creation_id = id;
	const metadata = creation_metadata[id];
	if (!metadata) {
		return { error: `bad id: ${id}` };
	}
	const result = import_widgets(
		localStorage.getItem(`${APP_ID}-${id}-description`)
	);
	if (result.error) {
		show_error(result.error);
	}
}

function new_creation() {
	creation_id = generate_creation_id();
	const result = import_widgets(null);
	if (result.error) {
		show_error(result.error);
	}
}

function load_most_recent_or_create_new() {
	let load = undefined;
	if (creation_metadata) {
		// load creation with largest lastViewed time
		for (const id in creation_metadata) {
			if (
				!load ||
				creation_metadata[id].lastViewed > creation_metadata[load].lastViewed
			) {
				load = id;
			}
		}
	}
	if (load) {
		load_creation(load);
	} else {
		new_creation();
	}
}

function get_shader_source() {
	const display_output = document.querySelector('.widget[data-display="1"]');
	if (!display_output) {
		show_error('no output chosen');
		return null;
	}
	const widgets = parse_widgets();
	if (widgets.error) {
		show_error(widgets);
		return null;
	}
	const state = new GLSLGenerationState(widgets);
	for (const widget of widgets.values()) {
		for (const control of widget.controls) {
			state.declarations.add(`uniform ${control.type} ${control.uniform};\n`);
		}
	}
	const output = state.compute_input(get_widget_name(display_output));
	if (output.error) {
		show_error(output);
		return null;
	}

	switch (output.type) {
		case 'float':
			state.add_code(`return vec3(${output.code});\n`);
			break;
		case 'vec2':
			state.add_code(`return vec3(${output.code}, 0.0);\n`);
			break;
		case 'vec3':
			state.add_code(`return ${output.code};\n`);
			break;
		case 'vec4':
			state.add_code(`return ${output.code}.xyz;\n`);
			break;
		default:
			show_error(`bad type for output: ${output.type}`);
			return null;
	}

	const code = state.get_code();
	export_widgets_to_local_storage();
	return code;
}

function update_widget_choices() {
	const search_term = widget_search.value.toLowerCase();
	const choices = widget_choices.getElementsByClassName('widget-choice');
	for (const choice of choices) {
		const widget = widget_info.get(choice.dataset.id);
		const shown =
			widget.name.toLowerCase().indexOf(search_term) !== -1 ||
			widget.alt.toLowerCase().indexOf(search_term) !== -1;
		choice.style.display = shown ? 'block' : 'none';
	}
	for (const category of widget_choices.getElementsByClassName(
		'widget-category'
	)) {
		if (
			Array.from(category.getElementsByClassName('widget-choice')).some(
				(x) => x.style.display === 'block'
			)
		) {
			category.style.display = 'block';
			category.open = search_term !== '';
		} else {
			category.style.display = 'none';
		}
	}
}

let resizing_ui = false;
let ui_resize_offset = 0;

function startup() {
	canvas_container = document.getElementById('canvas-container');
	canvas = document.getElementById('canvas');
	ui_div = document.getElementById('ui');
	ui_resize = document.getElementById('ui-resize');
	widget_choices = document.getElementById('widget-choices');
	widget_search = document.getElementById('widget-search');
	widgets_container = document.getElementById('widgets-container');
	code_input = document.getElementById('code');
	error_element = document.getElementById('error');
	creation_title_element = document.getElementById('creation-title');
	auto_update_element = document.getElementById('auto-update');

	const resolution_x_element = document.getElementById('resolution-x');
	const resolution_y_element = document.getElementById('resolution-y');

	ui_div.style.flexBasis = ui_div.offsetWidth + 'px'; // convert to px

	resolution_x_element.value = render_width;
	resolution_y_element.value = render_height;

	// drag to resize ui
	ui_resize.addEventListener('mousedown', (e) => {
		resizing_ui = true;
		const basis = ui_div.style.flexBasis;
		console.assert(basis.endsWith('px'));
		ui_resize_offset = basis.substring(0, basis.length - 2) - e.clientX;
		e.preventDefault();
	});
	window.addEventListener('mouseup', () => {
		resizing_ui = false;
	});
	window.addEventListener('mousemove', (e) => {
		if (resizing_ui) {
			if (e.buttons & 1) {
				ui_div.style.flexBasis = e.clientX + ui_resize_offset + 'px';
			} else {
				resizing_ui = false;
			}
			e.preventDefault();
		}
	});

	document.getElementById('about-button').addEventListener('click', () => {
		document.getElementById('about-dialog').showModal();
	});

	document.getElementById('list-creations').addEventListener('click', () => {
		const container = document.getElementById('creations');
		container.innerHTML = '';
		const creations_dialog = document.getElementById('creations-dialog');
		creations_dialog.showModal();
		for (const id in creation_metadata) {
			const metadata = creation_metadata[id];
			const entry = document.createElement('div');
			entry.classList.add('creation-entry');
			const title = document.createElement('h4');
			title.classList.add('creation-entry-title');
			title.appendChild(document.createTextNode(metadata.title));
			entry.appendChild(title);
			const lastViewed = document.createElement('div');
			lastViewed.classList.add('creation-entry-last-viewed');
			lastViewed.appendChild(
				document.createTextNode(
					'Last viewed: ' + new Date(metadata.lastViewed).toLocaleString()
				)
			);
			entry.appendChild(lastViewed);
			entry.addEventListener('click', () => {
				load_creation(id);
				creations_dialog.close();
			});
			container.appendChild(entry);
		}
	});

	document.getElementById('delete-creation').addEventListener('click', () => {
		document.getElementById('delete-creation-title').innerText =
			get_creation_title();
		document.getElementById('delete-dialog').showModal();
	});

	document
		.getElementById('delete-creation-confirm')
		.addEventListener('click', () => {
			delete creation_metadata[creation_id];
			localStorage.removeItem(`${APP_ID}-${creation_id}-description`);
			localStorage.setItem(
				`${APP_ID}-metadata`,
				JSON.stringify(creation_metadata)
			);
			creation_id = undefined;
			load_most_recent_or_create_new();
		});

	document.getElementById('new-creation').addEventListener('click', () => {
		new_creation();
	});

	document.getElementById('resolution-form').addEventListener('submit', () => {
		render_width = resolution_x_element.value;
		render_height = resolution_y_element.value;
		set_up_framebuffer();
	});

	document.getElementById('code-form').addEventListener('submit', () => {
		import_widgets(code_input.value);
	});

	pause_element = document.getElementById('pause');
	play_element = document.getElementById('play');
	step_element = document.getElementById('step');

	// need to update button disabled state.
	// ideally we would just put the initial state into the HTML
	// but fucking firefox https://bugzilla.mozilla.org/show_bug.cgi?id=654072
	set_paused(paused);

	pause_element.addEventListener('click', () => {
		set_paused(true);
	});
	play_element.addEventListener('click', () => {
		set_paused(false);
	});
	step_element.addEventListener('click', () => {
		perform_step();
	});

	document.getElementById('restart').addEventListener('click', () => {
		restart();
	});

	creation_title_element.addEventListener('change', () => {
		if (!has_error()) export_widgets_to_local_storage();
	});

	gl = canvas.getContext('webgl2');
	if (gl === null) {
		// support for very-old-but-not-ancient browsers
		gl = canvas.getContext('experimental-webgl2');
		if (gl === null) {
			show_error('your browser doesnt support webgl2.\noh well.');
			return;
		}
	}

	program_post = compile_program('post', {
		vertex: `#version 300 es
in vec2 v_pos;
out vec2 uv;

void main() {
	uv = v_pos * 0.5 + 0.5;
	gl_Position = vec4(v_pos, 0.0, 1.0);
}
`,
		fragment: `#version 300 es
#ifdef GL_ES
precision highp float;
#endif
uniform sampler2D u_texture;
in vec2 uv;
out vec4 color;

void main() {
	color = texture(u_texture, uv);
}
`,
	});
	if (program_post === null) {
		return;
	}

	vertex_buffer_rect = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_rect);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([
			-1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0,
		]),
		gl.STATIC_DRAW
	);

	vertex_buffer_main = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_main);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([
			-1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0,
		]),
		gl.STATIC_DRAW
	);

	framebuffer_color_texture = gl.createTexture();
	sampler_texture = gl.createTexture();
	framebuffer = gl.createFramebuffer();

	{
		// add widget buttons
		const categories = new Map();
		for (const info of widget_info.values()) {
			if (!categories.has(info.category)) {
				categories.set(info.category, []);
			}
			categories.get(info.category).push(info.id);
		}
		const category_names = Array.from(categories.keys());
		category_names.sort();

		for (const cat of category_names) {
			const category_element = document.createElement('details');
			category_element.classList.add('widget-category');
			const category_title = document.createElement('summary');
			category_title.appendChild(document.createTextNode(cat));
			category_element.appendChild(category_title);
			widget_choices.appendChild(category_element);

			const widgets = categories.get(cat);
			widgets.sort((a, b) =>
				widget_info.get(a).name.localeCompare(widget_info.get(b).name)
			);
			for (const id of widgets) {
				const widget = widget_info.get(id);
				const button = document.createElement('button');
				button.classList.add('widget-choice');
				if ('description' in widget) {
					button.title = widget.description;
				}
				button.appendChild(document.createTextNode(widget.name));
				button.dataset.id = id;
				category_element.appendChild(button);
				button.addEventListener('click', () => {
					const root = add_widget(id);
					const widget_name = root.querySelector('.widget-name');
					widget_name.focus();
					const range = document.createRange();
					range.selectNodeContents(widget_name);
					const sel = window.getSelection();
					sel.removeAllRanges();
					sel.addRange(range);
				});
			}
		}
	}

	set_up_framebuffer();
	update_widget_choices();
	widget_search.addEventListener('input', () => {
		update_widget_choices();
	});

	creation_metadata = parse_json(localStorage.getItem(`${APP_ID}-metadata`));
	load_most_recent_or_create_new();

	frame(0.0);

	canvas.addEventListener('mousemove', (e) => {
		mouse_pos_ndc.x = (e.offsetX / canvas.offsetWidth) * 2 - 1;
		mouse_pos_ndc.y = 1 - (e.offsetY / canvas.offsetHeight) * 2;
	});

	window.addEventListener('keydown', on_key_press);
}

let last_frame_time = undefined;
function frame(time) {
	time *= 1e-3; // just use seconds everybody

	if (last_frame_time !== undefined && !paused) {
		current_time += time - last_frame_time;
	}
	last_frame_time = time;

	const container_width = canvas_container.offsetWidth;
	const container_height = canvas_container.offsetHeight;
	const aspect_ratio = render_width / render_height;
	let canvas_x = 0,
		canvas_y = 0;
	if (container_width / aspect_ratio < container_height) {
		// landscape mode
		canvas_y = Math.floor((container_height - viewport_height) * 0.5);
		viewport_width = container_width;
		viewport_height = Math.floor(container_width / aspect_ratio);
	} else {
		// portrait mode
		canvas_x = Math.floor((container_width - viewport_width) * 0.5);
		viewport_width = Math.floor(container_height * aspect_ratio);
		viewport_height = container_height;
	}

	canvas.width = viewport_width;
	canvas.height = viewport_height;
	canvas.style.left = canvas_x + 'px';
	canvas.style.top = canvas_y + 'px';

	if (!paused) {
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
	const v_pos = gl.getAttribLocation(program_post, 'v_pos');
	gl.enableVertexAttribArray(v_pos);
	gl.vertexAttribPointer(v_pos, 2, gl.FLOAT, false, 0, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 6);

	if (!requestAnimationFrame) {
		show_error('your browser doesnt support requestAnimationFrame.\noh well.');
		return;
	}
	requestAnimationFrame(frame);
}

function perform_step() {
	if (!program_main) {
		// not properly loaded yet
		return;
	}

	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.viewport(0, 0, render_width, render_height);
	gl.clearColor(0.0, 0.0, 0.0, 1.0);
	gl.clear(gl.COLOR_BUFFER_BIT);

	gl.useProgram(program_main);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, sampler_texture);
	gl.uniform1i(gl.getUniformLocation(program_main, '_texture'), 0);
	gl.uniform1f(
		gl.getUniformLocation(program_main, '_time'),
		current_time % 3600
	);
	gl.uniform2f(
		gl.getUniformLocation(program_main, '_texture_size'),
		render_width,
		render_height
	);
	gl.uniform2f(
		gl.getUniformLocation(program_main, '_mouse'),
		mouse_pos_ndc.x,
		mouse_pos_ndc.y
	);

	if (parsed_widgets) {
		for (const widget of parsed_widgets.values()) {
			for (const control of widget.controls) {
				const loc = gl.getUniformLocation(program_main, control.uniform);
				const { type, value } = get_control_value(widget.id, control.id);
				switch (type) {
					case 'int':
						gl.uniform1i(loc, value);
						break;
					case 'float':
						gl.uniform1f(loc, value);
						break;
				}
			}
		}
	}

	gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer_main);
	const v_pos = gl.getAttribLocation(program_main, 'v_pos');
	gl.enableVertexAttribArray(v_pos);
	gl.vertexAttribPointer(v_pos, 2, gl.FLOAT, false, 8, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 6);

	gl.bindTexture(gl.TEXTURE_2D, sampler_texture);
	gl.copyTexImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		0,
		0,
		render_width,
		render_height,
		0
	);
}

function compile_program(name, shaders) {
	const program = gl.createProgram();
	for (const type in shaders) {
		const source = shaders[type];
		let gl_type;
		if (type === 'vertex') {
			gl_type = gl.VERTEX_SHADER;
		} else if (type === 'fragment') {
			gl_type = gl.FRAGMENT_SHADER;
		} else {
			show_error('unrecognized shader type: ' + type);
			return null;
		}
		const shader = compile_shader(name + ' ' + type, gl_type, source);
		if (shader === null) return null;
		gl.attachShader(program, shader);
	}

	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		show_error(
			'Error linking shader program:\n' + gl.getProgramInfoLog(program)
		);
		return null;
	}
	return program;
}

function set_up_framebuffer() {
	const sampler_pixels = new Uint8Array(render_width * render_height * 4);
	sampler_pixels.fill(0);
	set_up_rgba_texture(
		sampler_texture,
		render_width,
		render_height,
		sampler_pixels
	);
	set_up_rgba_texture(
		framebuffer_color_texture,
		render_width,
		render_height,
		null
	);
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(
		gl.FRAMEBUFFER,
		gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D,
		framebuffer_color_texture,
		0
	);
	const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		show_error('Error: framebuffer incomplete (status ' + status + ')');
		return;
	}
}

function set_up_rgba_texture(texture, width, height, pixels) {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		width,
		height,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		pixels
	);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function compile_shader(name, type, source) {
	const shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);

	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		show_error(
			'Error compiling shader ' + name + ':\n' + gl.getShaderInfoLog(shader)
		);
		return null;
	}
	return shader;
}

function has_error() {
	return error_element.style.display !== 'none';
}

function clear_error() {
	error_element.style.display = 'none';
	for (const widget of document.querySelectorAll('.widget.error')) {
		widget.classList.remove('error');
	}
}

function show_error(error) {
	if (error.error) {
		if (error.widget) {
			get_widget_by_id(error.widget).classList.add('error');
		}
		error = error.error;
	}
	console.log('error:', error);
	error_element.style.display = 'block';
	error_element.innerText = error;
}
