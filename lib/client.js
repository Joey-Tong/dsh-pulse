window.__ModuleLoader__.load({
	id: "dsh-pulse",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/meter.ts
		/**
		* How many characters of one burst move a channel's level from 0 to full.
		* Typing deliberately uses a much smaller constant than the stream channels:
		* keystrokes arrive one character at a time (a 8 chars/s typing rate would
		* otherwise sustain only ~0.1 level against the shared 28-char constant),
		* so the input channel gets its own burst tuning to stay visibly alive.
		*/
		const BURST_CHARS = {
			output: 28,
			thinking: 28,
			typing: 4
		};
		/** EMA smoothing factor applied to a rate reading on each observation. */
		const RATE_ALPHA = .4;
		const CHANNELS = [
			"output",
			"thinking",
			"tools",
			"typing"
		];
		const NEVER = -1;
		/**
		* One session's activity meter. Feed deltas from snapshot observations;
		* call {@link sample} once per animation frame with the frame time.
		*/
		var ActivityMeter = class {
			levels = {
				output: 0,
				thinking: 0,
				tools: 0,
				typing: 0
			};
			rates = {
				output: 0,
				thinking: 0,
				typing: 0
			};
			lastActivityAt = NEVER;
			lastSampleAt = NEVER;
			/**
			* Feed a character delta for one text channel.
			* @param channel - the text channel the characters belong to.
			* @param deltaChars - characters gained since the last observation (≤0 ignored).
			* @param now - current `performance.now()` reading in ms.
			*/
			feedChars(channel, deltaChars, now) {
				if (deltaChars <= 0) return;
				const instant = deltaChars / (this.lastSampleAt === NEVER ? 1e3 : Math.max(1, now - this.lastSampleAt)) * 1e3;
				const rate = this.rates[channel];
				this.rates[channel] = rate + RATE_ALPHA * (instant - rate);
				this.bump(channel, deltaChars / BURST_CHARS[channel], now);
			}
			/**
			* Feed one tool-call transition (a call started or settled).
			* @param now - current `performance.now()` reading in ms.
			*/
			feedTools(now) {
				this.bump("tools", .55, now);
			}
			/**
			* Record activity without moving any channel (e.g. a pending interaction
			* appeared) so the stuck detector stays satisfied.
			* @param now - current `performance.now()` reading in ms.
			*/
			noteActivity(now) {
				if (this.lastActivityAt === NEVER || now > this.lastActivityAt) this.lastActivityAt = now;
			}
			/**
			* Decay every level by the elapsed time and stamp the sample clock used as
			* the next rate denominator. Call once per animation frame.
			* @param dtSeconds - elapsed seconds since the previous frame.
			* @param now - current `performance.now()` reading in ms.
			*/
			sample(dtSeconds, now) {
				this.lastSampleAt = now;
				if (dtSeconds <= 0) return;
				const decay = Math.exp(-2.6 * dtSeconds);
				for (const channel of CHANNELS) {
					const next = this.levels[channel] * decay;
					this.levels[channel] = next < .01 ? 0 : next;
				}
			}
			/** Snapshot the current readings. */
			reading(now) {
				const channels = {};
				for (const channel of CHANNELS) channels[channel] = {
					level: this.levels[channel],
					charsPerSecond: channel === "tools" ? 0 : this.rates[channel]
				};
				return {
					channels,
					idleFor: this.idleFor(now)
				};
			}
			/** Bump one channel's level and mark activity. */
			bump(channel, amount, now) {
				const next = this.levels[channel] + Math.max(0, amount);
				this.levels[channel] = next >= 1 ? 1 : next;
				this.lastActivityAt = now;
			}
			/** Milliseconds since the last observed activity; Infinity before any. */
			idleFor(now) {
				return this.lastActivityAt === NEVER ? Infinity : Math.max(0, now - this.lastActivityAt);
			}
		};
		//#endregion
		//#region src/client/palette.ts
		/**
		* Equalizer color math: per-channel hues and the blending/lerp helpers the
		* canvas loop uses to shift the bar gradient smoothly between activity modes.
		* Pure functions, unit-testable without DOM.
		* @module dsh-pulse/client/palette
		*/
		/** Base hue per activity mode (HSL hue degrees). */
		const MODE_HUES = {
			idle: 214,
			output: 187,
			thinking: 262,
			tools: 38,
			typing: 152,
			stuck: 4,
			offline: 210
		};
		/** The idle hue used when nothing is active. */
		const IDLE_HUE = MODE_HUES.idle;
		/**
		* Weighted circular mean of hues (shortest-arc aware). Falls back to the
		* idle hue when no weight is positive.
		* @param entries - hue/weight pairs; weights are per-channel energy levels.
		* @returns the mean hue in [0, 360).
		*/
		function circularMeanHue(entries) {
			let x = 0;
			let y = 0;
			for (const { hue, weight } of entries) {
				if (weight <= 0) continue;
				const rad = hue * Math.PI / 180;
				x += Math.cos(rad) * weight;
				y += Math.sin(rad) * weight;
			}
			if (x === 0 && y === 0) return IDLE_HUE;
			return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
		}
		/** Linear interpolation with clamping. */
		function lerp(a, b, t) {
			const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
			return a + (b - a) * k;
		}
		/**
		* Interpolate between two hues along the shortest arc.
		* @param from - start hue in [0, 360).
		* @param to - target hue in [0, 360).
		* @param t - 0..1 blend factor.
		* @returns the blended hue in [0, 360).
		*/
		function lerpHue(from, to, t) {
			let delta = (to - from) % 360;
			if (delta < 0) delta += 360;
			if (delta > 180) delta -= 360;
			return ((from + delta * lerp(0, 1, t)) % 360 + 360) % 360;
		}
		/**
		* Hue blend factor per frame: frame-rate independent approach toward the
		* target (1 - exp(-k·dt)).
		* @param dtSeconds - seconds since the previous frame.
		* @param speed - blend speed constant (higher = snappier).
		* @returns the 0..1 factor.
		*/
		function frameBlend(dtSeconds, speed = 3) {
			return 1 - Math.exp(-speed * Math.max(0, dtSeconds));
		}
		/** Idle breathing peak amplitude (fraction of the bar height). */
		const IDLE_AMPLITUDE = .16;
		/** Per-channel Gaussian width in normalized [0, 1] bar space. */
		const CHANNEL_WIDTH = {
			output: .2,
			thinking: .16,
			tools: .09,
			typing: .26
		};
		/** Max boost applied to a full-energy channel's Gaussian. Typing sits at the
		*  top: its level rarely approaches 1 (each keystroke is a single character),
		*  so the bar boost compensates to keep the input channel visually loud. */
		const CHANNEL_BOOST = {
			output: .95,
			thinking: .85,
			tools: .9,
			typing: 1
		};
		/** Fresh peaks with every channel centered. */
		function freshPeaks() {
			return {
				output: .5,
				thinking: .5,
				tools: .5,
				typing: .5
			};
		}
		/**
		* Random-walk the channel peaks so the equalizer bands wander organically.
		* Deterministic in `now` (frame-quantized) so repeated frames at the same
		* time agree and tests can pin shapes.
		*/
		function driftPeaks(peaks, now, dtSeconds) {
			const frame = Math.floor(now / 300);
			for (const channel of Object.keys(peaks)) {
				const noise = Math.sin(frame * 12.9898 + channelCode(channel) * 78.233) * 43758.5453;
				const step = (noise - Math.floor(noise) - .5) * Math.min(.03, dtSeconds * 2);
				let next = peaks[channel] + step;
				if (next < .15) next = .15;
				if (next > .85) next = .85;
				peaks[channel] = next;
			}
		}
		/** Stable per-channel code for the deterministic noise hash. */
		function channelCode(channel) {
			switch (channel) {
				case "output": return 1;
				case "thinking": return 2;
				case "tools": return 3;
				case "typing": return 4;
			}
		}
		/** Deterministic per-bar, per-frame jitter in [-1, 1]. */
		function barNoise(i, now) {
			const raw = Math.sin(i * 127.1 + Math.floor(now / 110) * 311.7);
			return (raw - Math.floor(raw)) * 2 - 1;
		}
		/** One normalized Gaussian centered at `center` (0..1 bar space). */
		function gaussian(x, center, width) {
			const d = (x - center) / width;
			return Math.exp(-.5 * d * d);
		}
		/**
		* Rounded-rectangle envelope: bars near the strip's ends shrink along a
		* quarter-circle arc (corner zone = `CORNER` of the width each side), so the
		* waveform field itself reads as a rounded rectangle. This is a shape, not a
		* fade — the bars stay fully opaque, they are just shorter at the corners.
		*/
		const CORNER_FRACTION = .09;
		/** @param x - bar position in [0, 1]. @returns the envelope multiplier. */
		function cornerTaper(x) {
			const d = Math.min(x, 1 - x) / CORNER_FRACTION;
			if (d >= 1) return 1;
			return Math.sqrt(2 * d - d * d);
		}
		/**
		* Compute the per-bar heights (0..1) for one frame.
		* @param reading - the meter reading after decay.
		* @param peaks - drifting channel centers.
		* @param now - frame time in ms (drives idle breathing and jitter).
		* @param reducedMotion - when true the idle breathing is dropped.
		* @returns `BAR_COUNT` heights in [0, 1].
		*/
		function barHeights(reading, peaks, now, reducedMotion) {
			const heights = new Array(48);
			for (let i = 0; i < 48; i++) {
				const x = i / 47;
				let energy = 0;
				for (const channel of Object.keys(peaks)) {
					const level = reading.channels[channel].level;
					if (level <= 0) continue;
					energy += level * CHANNEL_BOOST[channel] * gaussian(x, peaks[channel], CHANNEL_WIDTH[channel]);
				}
				const idle = reducedMotion ? 0 : IDLE_AMPLITUDE * (.5 + .5 * Math.sin(now * .0013 + i * .55)) * (.5 + .5 * Math.sin(now * 7e-4 + i * .21));
				const jitter = barNoise(i, now) * .035 * (reducedMotion ? 0 : 1);
				let height = (idle + energy + jitter) * cornerTaper(x);
				if (height < 0) height = 0;
				if (height > 1) height = 1;
				heights[i] = height;
			}
			return heights;
		}
		/**
		* The hue the strip should drift toward this frame: circular mean of the
		* active channels weighted by their levels, overridden by global states
		* (stuck red, offline steel, pending amber).
		*/
		function targetHue(reading, state) {
			if (state.stuck) return MODE_HUES.stuck;
			if (state.network !== "connected") return MODE_HUES.offline;
			if (state.pendingCount > 0) return MODE_HUES.tools;
			const entries = [];
			for (const channel of Object.keys(reading.channels)) {
				const level = reading.channels[channel].level;
				if (level <= 0) continue;
				entries.push({
					hue: MODE_HUES[channel],
					weight: level
				});
			}
			return circularMeanHue(entries);
		}
		/**
		* Paint one frame. The caller keeps a `hueRef` holding the current blended
		* hue (mutated here toward the target) so mode shifts glide instead of snap.
		*/
		function drawPulse(context, size, reading, peaks, state, now, hueRef) {
			const { width, height } = size;
			if (width <= 0 || height <= 0) return;
			context.clearRect(0, 0, width, height);
			const heights = barHeights(reading, peaks, now, state.reducedMotion);
			const target = targetHue(reading, state);
			hueRef.current = lerpHue(hueRef.current, target, frameBlend(1 / 60, 3));
			const hue = hueRef.current;
			const saturation = state.network !== "connected" || state.stuck ? 45 : 88;
			const gap = Math.min(3, width / 48 / 4);
			const barW = (width - gap * 47) / 48;
			const maxH = height - 6;
			const baseline = height - 3;
			for (let i = 0; i < 48; i++) {
				const h = Math.max(1, heights[i] * maxH);
				const x = i * (barW + gap);
				const y = baseline - h;
				const radius = Math.min(2, h / 2);
				context.fillStyle = `hsla(${hue}, ${saturation}%, 55%, ${.1 + .12 * heights[i]})`;
				roundRect(context, x - gap / 2, baseline - maxH, barW + gap, maxH, radius);
				context.fill();
				context.fillStyle = `hsla(${hue}, ${saturation}%, ${50 + 20 * heights[i]}%, 0.92)`;
				roundRect(context, x, y, barW, h, radius);
				context.fill();
			}
			context.fillStyle = state.darkTheme ? "rgba(255, 255, 255, 0.07)" : "rgba(15, 23, 42, 0.10)";
			context.fillRect(0, height - 1, width, 1);
		}
		/** Fill a rounded rect with a graceful fallback for engines without roundRect. */
		function roundRect(context, x, y, w, h, radius) {
			if (typeof context.roundRect === "function") {
				context.beginPath();
				context.roundRect(x, y, w, h, radius);
				context.fill();
				return;
			}
			context.fillRect(x, y, w, h);
		}
		//#endregion
		//#region \0dsh-css:/Users/bigo/Documents/research/ds-plugin/src/client/PulseBar.module.css.mjs
		const css = ".TN_I9W_wrap{align-items:center;gap:calc(10px * var(--pulse-scale-h,1));box-sizing:border-box;width:100%;max-width:calc(var(--dsh-composer-card-max-width,780px) * var(--pulse-scale-w,1));padding:calc(3px * var(--pulse-scale-h,1)) 14px;backdrop-filter:blur(14px)saturate(1.5);background:linear-gradient(#ffffff1a,#ffffff05 60%,#ffffff0f),#10141e80;border:1px solid #ffffff12;border-radius:16px;margin:0 auto;display:flex;position:relative;box-shadow:0 6px 20px #00000029,inset 0 1px #ffffff12}body[data-ds-dark-theme] .TN_I9W_wrap{background:linear-gradient(#ffffff14,#ffffff05 60%,#ffffff0d),#0d111b8c;border-color:#ffffff17}.TN_I9W_canvas{min-width:0;height:calc(30px * var(--pulse-scale-h,1));flex:auto;display:block}.TN_I9W_chips{max-height:calc(37px * min(var(--pulse-scale-h,1), 1));gap:calc(3px * min(var(--pulse-scale-h,1), 1)) calc(6px * min(var(--pulse-scale-h,1), 1));flex-flow:column wrap;flex:none;min-width:0;max-width:70%;display:flex;overflow:hidden}.TN_I9W_chip{align-items:center;gap:calc(4px * min(var(--pulse-scale-h,1), 1));padding:calc(1px * min(var(--pulse-scale-h,1), 1)) calc(7px * min(var(--pulse-scale-h,1), 1));font-size:calc(10px * min(var(--pulse-scale-h,1), 1));line-height:calc(13px * min(var(--pulse-scale-h,1), 1));white-space:nowrap;color:#e2e8f0d1;background:#ffffff12;border:1px solid #ffffff0f;border-radius:999px;display:inline-flex}body[data-ds-dark-theme] .TN_I9W_chip{color:#e2e8f0d9;background:#ffffff0f}.TN_I9W_dot{width:calc(5px * min(var(--pulse-scale-h,1), 1));height:calc(5px * min(var(--pulse-scale-h,1), 1));border-radius:50%;flex:none}.TN_I9W_resize{width:calc(32px * var(--pulse-scale-h,1));height:calc(30px * var(--pulse-scale-h,1));cursor:nesw-resize;position:absolute;top:0;right:0}.TN_I9W_dotOutput{background:#36dcf2}.TN_I9W_dotThinking{background:#9c6af0}.TN_I9W_dotTools{background:#f6ae31}.TN_I9W_dotTyping{background:#1ce386}.TN_I9W_dotNetwork{background:#25d07a}.TN_I9W_dotNetworkBad{background:#ef4f43}.TN_I9W_dotNetworkWarn{background:#f6ae31}.TN_I9W_dotStuck{background:#ef4f43}.TN_I9W_chipStuck{border-color:#ef4f4373;animation:1.2s ease-in-out infinite TN_I9W_pulse-stuck}@keyframes TN_I9W_pulse-stuck{0%,to{opacity:1}50%{opacity:.55}}@media (width<=640px){.TN_I9W_wrap{padding-left:10px;padding-right:10px}.TN_I9W_chips{max-width:55%}.TN_I9W_chipHideNarrow{display:none}}@media (prefers-reduced-motion:reduce){.TN_I9W_chipStuck{animation:none}}";
		const tagId = "dsh-pulse/PulseBar.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-pulse";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var PulseBar_module_css_default = {
			"chipStuck": "TN_I9W_chipStuck",
			"resize": "TN_I9W_resize",
			"dot": "TN_I9W_dot",
			"dotTools": "TN_I9W_dotTools",
			"dotTyping": "TN_I9W_dotTyping",
			"dotNetworkBad": "TN_I9W_dotNetworkBad",
			"chips": "TN_I9W_chips",
			"dotOutput": "TN_I9W_dotOutput",
			"pulse-stuck": "TN_I9W_pulse-stuck",
			"canvas": "TN_I9W_canvas",
			"chip": "TN_I9W_chip",
			"dotNetwork": "TN_I9W_dotNetwork",
			"dotThinking": "TN_I9W_dotThinking",
			"dotNetworkWarn": "TN_I9W_dotNetworkWarn",
			"dotStuck": "TN_I9W_dotStuck",
			"chipHideNarrow": "TN_I9W_chipHideNarrow",
			"wrap": "TN_I9W_wrap"
		};
		/** Size factors (width × height), each bounded so the strip stays usable. */
		const SCALE_W_MIN = .5;
		const SCALE_W_MAX = 1.5;
		const SCALE_H_MIN = .6;
		const SCALE_H_MAX = 1.6;
		/** Size change per pointer-pixel of drag (both axes). */
		const SCALE_PER_PX = .008;
		/** localStorage keys for the per-user size preference. */
		const SCALE_W_KEY = "dsh-pulse:scale-w";
		const SCALE_H_KEY = "dsh-pulse:scale-h";
		/** Clamp a value into a range. */
		function clamp(value, min, max) {
			if (value < min) return min;
			if (value > max) return max;
			return value;
		}
		/** Load one persisted scale (default 1). */
		function loadScale(key, min, max) {
			if (typeof localStorage === "undefined") return 1;
			const raw = Number(localStorage.getItem(key));
			return Number.isFinite(raw) && raw > 0 ? clamp(raw, min, max) : 1;
		}
		const loadScaleW = () => loadScale(SCALE_W_KEY, SCALE_W_MIN, SCALE_W_MAX);
		const loadScaleH = () => loadScale(SCALE_H_KEY, SCALE_H_MIN, SCALE_H_MAX);
		const EMPTY_SUMMARY = {
			outputRate: 0,
			thinkingRate: 0,
			typingRate: 0,
			tools: 0,
			pendingKind: null,
			running: false,
			stuck: false,
			network: "connecting"
		};
		/** Sum the streamed text/reasoning characters of the in-progress partial. */
		function partialLengths(session) {
			const partial = session.partial;
			if (partial === null) return {
				text: 0,
				reasoning: 0
			};
			let text = 0;
			let reasoning = 0;
			for (const block of partial.blocks) if (block.kind === "text") text += block.text.length;
			else if (block.kind === "reasoning") reasoning += block.text.length;
			return {
				text,
				reasoning
			};
		}
		/** First pending kind, or null. */
		function firstPendingKind(pending) {
			return pending.length === 0 ? null : pending[0].kind;
		}
		const PulseBar = (0, react.memo)(function PulseBar({ session, input, connection, t }) {
			const wrapRef = (0, react.useRef)(null);
			const canvasRef = (0, react.useRef)(null);
			const meterRef = (0, react.useRef)(null);
			if (meterRef.current === null) meterRef.current = new ActivityMeter();
			const sizeRef = (0, react.useRef)({
				width: 0,
				height: 0,
				dpr: 1
			});
			const peaksRef = (0, react.useRef)(freshPeaks());
			const hueRef = (0, react.useRef)(214);
			const lastLensRef = (0, react.useRef)({
				text: 0,
				reasoning: 0
			});
			const lastInputLenRef = (0, react.useRef)(input.draft.length);
			const lastCallsRef = (0, react.useRef)(session.runningCalls.length);
			const lastPendingRef = (0, react.useRef)(session.pending.length);
			const runningRef = (0, react.useRef)(session.running);
			const pendingRef = (0, react.useRef)(session.pending);
			const toolsRef = (0, react.useRef)(session.runningCalls.length);
			const stuckRef = (0, react.useRef)(false);
			const networkRef = (0, react.useRef)("connecting");
			const reducedRef = (0, react.useRef)(false);
			const darkRef = (0, react.useRef)(false);
			const [network, setNetwork] = (0, react.useState)("connecting");
			const [summary, setSummary] = (0, react.useState)(EMPTY_SUMMARY);
			const [scaleW, setScaleW] = (0, react.useState)(loadScaleW);
			const [scaleH, setScaleH] = (0, react.useState)(loadScaleH);
			const dragRef = (0, react.useRef)(null);
			const lastStretchRef = (0, react.useRef)({
				w: scaleW !== 1 ? scaleW : 1,
				h: scaleH !== 1 ? scaleH : 1
			});
			(0, react.useEffect)(() => {
				try {
					localStorage.setItem(SCALE_W_KEY, String(scaleW));
					localStorage.setItem(SCALE_H_KEY, String(scaleH));
				} catch {}
			}, [scaleW, scaleH]);
			(0, react.useEffect)(() => {
				if (Math.abs(scaleW - 1) > .01 || Math.abs(scaleH - 1) > .01) lastStretchRef.current = {
					w: scaleW,
					h: scaleH
				};
			}, [scaleW, scaleH]);
			(0, react.useEffect)(() => {
				const meter = meterRef.current;
				if (meter === null) return;
				const now = performance.now();
				const lens = partialLengths(session);
				const last = lastLensRef.current;
				meter.feedChars("output", lens.text - last.text, now);
				meter.feedChars("thinking", lens.reasoning - last.reasoning, now);
				lastLensRef.current = lens;
				const calls = session.runningCalls.length;
				if (calls !== lastCallsRef.current) {
					meter.feedTools(now);
					lastCallsRef.current = calls;
				}
				const pending = session.pending.length;
				if (pending !== lastPendingRef.current) {
					meter.noteActivity(now);
					lastPendingRef.current = pending;
				}
				runningRef.current = session.running;
				pendingRef.current = session.pending;
				toolsRef.current = session.runningCalls.length;
			}, [session]);
			(0, react.useEffect)(() => {
				const meter = meterRef.current;
				if (meter === null) return;
				const len = input.draft.length;
				meter.feedChars("typing", len - lastInputLenRef.current, performance.now());
				lastInputLenRef.current = len;
			}, [input]);
			(0, react.useEffect)(() => {
				let hadConnection = connection.getSnapshot() !== void 0;
				const update = () => {
					const connected = connection.getSnapshot() !== void 0;
					const next = connected ? "connected" : hadConnection ? "reconnecting" : "connecting";
					hadConnection = connected;
					networkRef.current = next;
					setNetwork((prev) => prev === next ? prev : next);
				};
				update();
				return connection.subscribe(update);
			}, [connection]);
			(0, react.useEffect)(() => {
				const wrap = wrapRef.current;
				const canvas = canvasRef.current;
				if (wrap === null || canvas === null) return;
				const context = canvas.getContext("2d");
				if (context === null) return;
				const size = sizeRef.current;
				const fit = () => {
					const dpr = window.devicePixelRatio || 1;
					const width = Math.max(0, canvas.clientWidth);
					const height = Math.max(0, canvas.clientHeight);
					const nextW = Math.round(width * dpr);
					const nextH = Math.round(height * dpr);
					if (canvas.width !== nextW) canvas.width = nextW;
					if (canvas.height !== nextH) canvas.height = nextH;
					size.width = width;
					size.height = height;
					size.dpr = dpr;
					context.setTransform(dpr, 0, 0, dpr, 0, 0);
				};
				fit();
				const media = window.matchMedia("(prefers-reduced-motion: reduce)");
				const applyReduced = () => {
					reducedRef.current = media.matches;
				};
				applyReduced();
				media.addEventListener("change", applyReduced);
				const applyDark = () => {
					darkRef.current = document.body.hasAttribute("data-ds-dark-theme");
				};
				applyDark();
				const themeObserver = new MutationObserver(applyDark);
				themeObserver.observe(document.body, {
					attributes: true,
					attributeFilter: ["data-ds-dark-theme"]
				});
				let raf = 0;
				let last = performance.now();
				const loop = (now) => {
					const dt = Math.min(.1, Math.max(0, (now - last) / 1e3));
					last = now;
					const meter = meterRef.current;
					if (meter !== null) {
						meter.sample(dt, now);
						const reading = meter.reading(now);
						driftPeaks(peaksRef.current, now, dt);
						const state = {
							running: runningRef.current,
							stuck: stuckRef.current,
							pendingCount: pendingRef.current.length,
							network: networkRef.current,
							darkTheme: darkRef.current,
							reducedMotion: reducedRef.current
						};
						drawPulse(context, sizeRef.current, reading, peaksRef.current, state, now, hueRef);
					}
					raf = requestAnimationFrame(loop);
				};
				raf = requestAnimationFrame(loop);
				const observer = new ResizeObserver(fit);
				observer.observe(wrap);
				const tick = () => {
					const meter = meterRef.current;
					if (meter === null) return;
					const now = performance.now();
					const reading = meter.reading(now);
					const running = runningRef.current;
					const pending = pendingRef.current;
					const tools = toolsRef.current;
					const stuck = running && pending.length === 0 && tools === 0 && reading.idleFor > 8e3;
					stuckRef.current = stuck;
					const out = reading.channels.output;
					const think = reading.channels.thinking;
					const type = reading.channels.typing;
					setSummary({
						outputRate: out.level > 0 ? out.charsPerSecond : 0,
						thinkingRate: think.level > 0 ? think.charsPerSecond : 0,
						typingRate: type.level > 0 ? type.charsPerSecond : 0,
						tools,
						pendingKind: firstPendingKind(pending),
						running,
						stuck,
						network: networkRef.current
					});
				};
				tick();
				const interval = window.setInterval(tick, 250);
				return () => {
					cancelAnimationFrame(raf);
					window.clearInterval(interval);
					observer.disconnect();
					themeObserver.disconnect();
					media.removeEventListener("change", applyReduced);
				};
			}, []);
			const { outputRate, thinkingRate, typingRate, tools, pendingKind, running, stuck } = summary;
			const pendingLabel = pendingKind === null ? null : pendingKind === "approval" ? "chip.pendingApproval" : "chip.pendingOther";
			const networkKey = network === "connected" ? "network.connected" : network === "reconnecting" ? "network.reconnecting" : "network.connecting";
			const ariaKey = stuck ? "aria.stuck" : running ? "aria.running" : "aria.idle";
			const ariaLabel = (0, react.useMemo)(() => t(ariaKey, { network: t(networkKey) }), [
				t,
				ariaKey,
				networkKey
			]);
			const showOutput = running && outputRate >= 1;
			const showThinking = running && thinkingRate >= 1;
			const showTools = running && tools > 0;
			const showPending = pendingLabel !== null;
			const showStuck = stuck;
			const showTyping = typingRate >= 2;
			const showNetwork = network !== "connected" || !(showOutput || showThinking || showTools || showPending || showStuck || showTyping);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: wrapRef,
				className: PulseBar_module_css_default.wrap,
				role: "group",
				"aria-label": ariaLabel,
				"data-dsh-pulse": true,
				style: {
					"--pulse-scale-w": String(scaleW),
					"--pulse-scale-h": String(scaleH)
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
						ref: canvasRef,
						className: PulseBar_module_css_default.canvas,
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PulseBar_module_css_default.chips,
						children: [
							showNetwork && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: PulseBar_module_css_default.chip,
								title: t(networkKey),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${PulseBar_module_css_default.dot} ${network === "connected" ? PulseBar_module_css_default.dotNetwork : network === "reconnecting" ? PulseBar_module_css_default.dotNetworkBad : PulseBar_module_css_default.dotNetworkWarn}` }), t(networkKey)]
							}),
							showOutput && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: `${PulseBar_module_css_default.chip} ${PulseBar_module_css_default.chipHideNarrow}`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${PulseBar_module_css_default.dot} ${PulseBar_module_css_default.dotOutput}` }), t("chip.output", { rate: Math.round(outputRate) })]
							}),
							showThinking && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: `${PulseBar_module_css_default.chip} ${PulseBar_module_css_default.chipHideNarrow}`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${PulseBar_module_css_default.dot} ${PulseBar_module_css_default.dotThinking}` }), t("chip.thinking", { rate: Math.round(thinkingRate) })]
							}),
							showTools && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: `${PulseBar_module_css_default.chip} ${PulseBar_module_css_default.chipHideNarrow}`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${PulseBar_module_css_default.dot} ${PulseBar_module_css_default.dotTools}` }), t("chip.tools", { count: tools })]
							}),
							showPending && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: PulseBar_module_css_default.chip,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${PulseBar_module_css_default.dot} ${PulseBar_module_css_default.dotTools}` }), t(pendingLabel)]
							}),
							showStuck && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: `${PulseBar_module_css_default.chip} ${PulseBar_module_css_default.chipStuck}`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${PulseBar_module_css_default.dot} ${PulseBar_module_css_default.dotStuck}` }), t("chip.stuck")]
							}),
							showTyping && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: PulseBar_module_css_default.chip,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${PulseBar_module_css_default.dot} ${PulseBar_module_css_default.dotTyping}` }), t("chip.typing", { rate: Math.round(typingRate) })]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: PulseBar_module_css_default.resize,
						role: "slider",
						"aria-label": t("size.drag"),
						"aria-valuemin": SCALE_H_MIN * 100,
						"aria-valuemax": SCALE_H_MAX * 100,
						"aria-valuenow": Math.round(scaleH * 100),
						"aria-valuetext": `${Math.round(scaleW * 100)}% × ${Math.round(scaleH * 100)}%`,
						tabIndex: 0,
						title: t("size.drag"),
						onPointerDown: (e) => {
							dragRef.current = {
								x: e.clientX,
								y: e.clientY,
								w: scaleW,
								h: scaleH
							};
							e.currentTarget.setPointerCapture(e.pointerId);
						},
						onPointerMove: (e) => {
							const d = dragRef.current;
							if (d === null) return;
							setScaleW(clamp(d.w + (e.clientX - d.x) * SCALE_PER_PX, SCALE_W_MIN, SCALE_W_MAX));
							setScaleH(clamp(d.h - (e.clientY - d.y) * SCALE_PER_PX, SCALE_H_MIN, SCALE_H_MAX));
						},
						onPointerUp: () => {
							dragRef.current = null;
						},
						onPointerCancel: () => {
							dragRef.current = null;
						},
						onDoubleClick: () => {
							if (Math.abs(scaleW - 1) < .01 && Math.abs(scaleH - 1) < .01) {
								setScaleW(lastStretchRef.current.w);
								setScaleH(lastStretchRef.current.h);
							} else {
								setScaleW(1);
								setScaleH(1);
							}
						},
						onKeyDown: (e) => {
							if (e.key === "ArrowUp" || e.key === "ArrowRight") {
								e.preventDefault();
								setScaleH((s) => clamp(s + .05, SCALE_H_MIN, SCALE_H_MAX));
							} else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
								e.preventDefault();
								setScaleH((s) => clamp(s - .05, SCALE_H_MIN, SCALE_H_MAX));
							}
						}
					})
				]
			});
		});
		//#endregion
		//#region src/client/locales.ts
		/** `pulse` namespace dictionaries. */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"network.connected": "网络正常",
			"network.connecting": "连接中",
			"network.reconnecting": "网络重连中",
			"chip.output": "输出 {rate} 字符/秒",
			"chip.thinking": "思考 {rate} 字符/秒",
			"chip.tools": "工具 ×{count}",
			"chip.typing": "输入 {rate} 字符/秒",
			"chip.pendingApproval": "等待确认",
			"chip.pendingOther": "等待回应",
			"chip.stuck": "响应停滞",
			"size.drag": "拖动调节大小",
			"aria.idle": "会话空闲，{network}",
			"aria.running": "会话运行中，{network}",
			"aria.stuck": "会话响应停滞，{network}"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"network.connected": "Network OK",
			"network.connecting": "Connecting",
			"network.reconnecting": "Reconnecting",
			"chip.output": "Output {rate} chars/s",
			"chip.thinking": "Thinking {rate} chars/s",
			"chip.tools": "Tools ×{count}",
			"chip.typing": "Typing {rate} chars/s",
			"chip.pendingApproval": "Awaiting approval",
			"chip.pendingOther": "Awaiting input",
			"chip.stuck": "Response stalled",
			"size.drag": "Drag to resize",
			"aria.idle": "Session idle, {network}",
			"aria.running": "Session running, {network}",
			"aria.stuck": "Session response stalled, {network}"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "pulse";
		/** Required services: the slot registry, the wire handle, and the copy. */
		const inject = [
			"slots",
			"connection",
			"locale"
		];
		/**
		* Client plugin body: the pulse dock entry.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-pulse: dictionaries");
			const connection = ctx.get("connection");
			ctx.slots.inject("conversation.input.dock", () => {
				return ctx.slots.register({
					name: "conversation.input.dock",
					id: "pulse",
					order: -10,
					locale: NS,
					inject: () => ({ connection: connection.hostDescription })
				}, PulseBar);
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map