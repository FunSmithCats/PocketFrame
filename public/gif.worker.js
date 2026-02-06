// gif.js worker script
// This file is served from public/ and used by gif.js for encoding

(function() {
  // Minimal gif.js worker implementation
  // The actual worker code comes from gif.js package
  // This is a placeholder that will be replaced by the actual worker

  var GIFEncoder, NeuQuant, TypedNeuQuant, LZWEncoder;

  // NeuQuant neural-net quantization algorithm
  // Adapted from code by Anthony Dekker (1994)
  NeuQuant = function(pixels, samplefac) {
    var network, netindex, bias, freq, radpower;

    var netsize = 256;
    var prime1 = 499, prime2 = 491, prime3 = 487, prime4 = 503;
    var minpicturebytes = 3 * prime4;
    var maxnetpos = netsize - 1;
    var netbiasshift = 4;
    var ncycles = 100;
    var intbiasshift = 16;
    var intbias = 1 << intbiasshift;
    var gammashift = 10;
    var betashift = 10;
    var beta = intbias >> betashift;
    var betagamma = intbias << (gammashift - betashift);
    var initrad = netsize >> 3;
    var radiusbiasshift = 6;
    var radiusbias = 1 << radiusbiasshift;
    var initradius = initrad * radiusbias;
    var radiusdec = 30;
    var alphabiasshift = 10;
    var initalpha = 1 << alphabiasshift;
    var radbiasshift = 8;
    var radbias = 1 << radbiasshift;
    var alpharadbshift = alphabiasshift + radbiasshift;
    var alpharadbias = 1 << alpharadbshift;

    var thepicture, lengthcount;
    var samplefac;

    function init(thepic, len, sample) {
      network = [];
      netindex = new Int32Array(256);
      bias = new Int32Array(netsize);
      freq = new Int32Array(netsize);
      radpower = new Int32Array(netsize >> 3);

      thepicture = thepic;
      lengthcount = len;
      samplefac = sample;

      for (var i = 0; i < netsize; i++) {
        network[i] = new Float64Array(4);
        network[i][0] = network[i][1] = network[i][2] = (i << (netbiasshift + 8)) / netsize | 0;
        freq[i] = intbias / netsize | 0;
        bias[i] = 0;
      }
    }

    function unbiasnet() {
      for (var i = 0; i < netsize; i++) {
        network[i][0] >>= netbiasshift;
        network[i][1] >>= netbiasshift;
        network[i][2] >>= netbiasshift;
        network[i][3] = i;
      }
    }

    function altersingle(alpha, i, b, g, r) {
      network[i][0] -= alpha * (network[i][0] - b) / initalpha | 0;
      network[i][1] -= alpha * (network[i][1] - g) / initalpha | 0;
      network[i][2] -= alpha * (network[i][2] - r) / initalpha | 0;
    }

    function alterneigh(radius, i, b, g, r) {
      var lo = Math.abs(i - radius);
      var hi = Math.min(i + radius, netsize);
      var j = i + 1, k = i - 1, m = 1;

      while (j < hi || k > lo) {
        var a = radpower[m++];
        if (j < hi) {
          var p = network[j++];
          p[0] -= a * (p[0] - b) / alpharadbias | 0;
          p[1] -= a * (p[1] - g) / alpharadbias | 0;
          p[2] -= a * (p[2] - r) / alpharadbias | 0;
        }
        if (k > lo) {
          var p = network[k--];
          p[0] -= a * (p[0] - b) / alpharadbias | 0;
          p[1] -= a * (p[1] - g) / alpharadbias | 0;
          p[2] -= a * (p[2] - r) / alpharadbias | 0;
        }
      }
    }

    function contest(b, g, r) {
      var bestd = ~(1 << 31), bestbiasd = bestd, bestpos = -1, bestbiaspos = bestpos;

      for (var i = 0; i < netsize; i++) {
        var n = network[i];
        var dist = Math.abs(n[0] - b) + Math.abs(n[1] - g) + Math.abs(n[2] - r);
        if (dist < bestd) {
          bestd = dist;
          bestpos = i;
        }
        var biasdist = dist - (bias[i] >> (intbiasshift - netbiasshift));
        if (biasdist < bestbiasd) {
          bestbiasd = biasdist;
          bestbiaspos = i;
        }
        var betafreq = freq[i] >> betashift;
        freq[i] -= betafreq;
        bias[i] += betafreq << gammashift;
      }
      freq[bestpos] += beta;
      bias[bestpos] -= betagamma;
      return bestbiaspos;
    }

    function inxbuild() {
      var previouscol = 0, startpos = 0;
      for (var i = 0; i < netsize; i++) {
        var p = network[i];
        var smallpos = i, smallval = p[1];
        for (var j = i + 1; j < netsize; j++) {
          var q = network[j];
          if (q[1] < smallval) {
            smallpos = j;
            smallval = q[1];
          }
        }
        var q = network[smallpos];
        if (i != smallpos) {
          var j = q[0]; q[0] = p[0]; p[0] = j;
          j = q[1]; q[1] = p[1]; p[1] = j;
          j = q[2]; q[2] = p[2]; p[2] = j;
          j = q[3]; q[3] = p[3]; p[3] = j;
        }
        if (smallval != previouscol) {
          netindex[previouscol] = (startpos + i) >> 1;
          for (var j = previouscol + 1; j < smallval; j++) netindex[j] = i;
          previouscol = smallval;
          startpos = i;
        }
      }
      netindex[previouscol] = (startpos + maxnetpos) >> 1;
      for (var j = previouscol + 1; j < 256; j++) netindex[j] = maxnetpos;
    }

    function learn() {
      var i, j, b, g, r;
      var radius, rad, alpha, step, delta, samplepixels;
      var pix, lim;

      if (lengthcount < minpicturebytes) samplefac = 1;
      var alphadec = 30 + ((samplefac - 1) / 3);
      pix = 0;
      lim = lengthcount;
      samplepixels = lengthcount / (3 * samplefac);
      delta = samplepixels / ncycles | 0;
      alpha = initalpha;
      radius = initradius;

      rad = radius >> radiusbiasshift;
      if (rad <= 1) rad = 0;
      for (i = 0; i < rad; i++) radpower[i] = alpha * (((rad * rad - i * i) * radbias) / (rad * rad)) | 0;

      if (lengthcount < minpicturebytes) step = 3;
      else if (lengthcount % prime1 !== 0) step = 3 * prime1;
      else {
        if (lengthcount % prime2 !== 0) step = 3 * prime2;
        else {
          if (lengthcount % prime3 !== 0) step = 3 * prime3;
          else step = 3 * prime4;
        }
      }

      i = 0;
      while (i < samplepixels) {
        b = (thepicture[pix + 0] & 0xff) << netbiasshift;
        g = (thepicture[pix + 1] & 0xff) << netbiasshift;
        r = (thepicture[pix + 2] & 0xff) << netbiasshift;
        j = contest(b, g, r);
        altersingle(alpha, j, b, g, r);
        if (rad !== 0) alterneigh(rad, j, b, g, r);
        pix += step;
        if (pix >= lim) pix -= lengthcount;
        i++;
        if (delta === 0) delta = 1;
        if (i % delta === 0) {
          alpha -= alpha / alphadec;
          radius -= radius / radiusdec;
          rad = radius >> radiusbiasshift;
          if (rad <= 1) rad = 0;
          for (j = 0; j < rad; j++) radpower[j] = alpha * (((rad * rad - j * j) * radbias) / (rad * rad)) | 0;
        }
      }
    }

    function map(b, g, r) {
      var i, j, dist, a, bestd, p, best;
      bestd = 1000;
      best = -1;
      i = netindex[g];
      j = i - 1;
      while (i < netsize || j >= 0) {
        if (i < netsize) {
          p = network[i];
          dist = p[1] - g;
          if (dist >= bestd) i = netsize;
          else {
            i++;
            if (dist < 0) dist = -dist;
            a = p[0] - b; if (a < 0) a = -a; dist += a;
            if (dist < bestd) {
              a = p[2] - r; if (a < 0) a = -a; dist += a;
              if (dist < bestd) { bestd = dist; best = p[3]; }
            }
          }
        }
        if (j >= 0) {
          p = network[j];
          dist = g - p[1];
          if (dist >= bestd) j = -1;
          else {
            j--;
            if (dist < 0) dist = -dist;
            a = p[0] - b; if (a < 0) a = -a; dist += a;
            if (dist < bestd) {
              a = p[2] - r; if (a < 0) a = -a; dist += a;
              if (dist < bestd) { bestd = dist; best = p[3]; }
            }
          }
        }
      }
      return best;
    }

    function process() {
      learn();
      unbiasnet();
      inxbuild();
    }

    function colorMap() {
      var map = [];
      var index = [];
      for (var i = 0; i < netsize; i++) index[network[i][3]] = i;
      var k = 0;
      for (var i = 0; i < netsize; i++) {
        var j = index[i];
        map[k++] = network[j][0] | 0;
        map[k++] = network[j][1] | 0;
        map[k++] = network[j][2] | 0;
      }
      return map;
    }

    init(pixels, pixels.length, samplefac);

    return {
      process: process,
      colorMap: colorMap,
      map: map
    };
  };

  // LZW encoder for GIF
  LZWEncoder = function(width, height, pixels, colorDepth) {
    var initCodeSize = Math.max(2, colorDepth);
    var accum = new Uint8Array(256);
    var htab = new Int32Array(5003);
    var codetab = new Int32Array(5003);

    var cur_accum, cur_bits, a_count, free_ent, maxcode, clear_flg;
    var g_init_bits, ClearCode, EOFCode, remaining, curPixel, n_bits;

    function char_out(c, outs) {
      accum[a_count++] = c;
      if (a_count >= 254) flush_char(outs);
    }

    function cl_block(outs) {
      cl_hash(5003);
      free_ent = ClearCode + 2;
      clear_flg = true;
      output(ClearCode, outs);
    }

    function cl_hash(hsize) {
      for (var i = 0; i < hsize; ++i) htab[i] = -1;
    }

    function compress(init_bits, outs) {
      var fcode, c, i, ent, disp, hsize_reg, hshift;

      g_init_bits = init_bits;
      clear_flg = false;
      n_bits = g_init_bits;
      maxcode = (1 << n_bits) - 1;
      ClearCode = 1 << (init_bits - 1);
      EOFCode = ClearCode + 1;
      free_ent = ClearCode + 2;
      a_count = 0;
      ent = nextPixel();
      hshift = 0;
      for (fcode = 5003; fcode < 65536; fcode *= 2) ++hshift;
      hshift = 8 - hshift;
      hsize_reg = 5003;
      cl_hash(hsize_reg);
      output(ClearCode, outs);

      outer_loop:
      while ((c = nextPixel()) != -1) {
        fcode = (c << 12) + ent;
        i = (c << hshift) ^ ent;
        if (htab[i] === fcode) {
          ent = codetab[i];
          continue;
        } else if (htab[i] >= 0) {
          disp = hsize_reg - i;
          if (i === 0) disp = 1;
          do {
            if ((i -= disp) < 0) i += hsize_reg;
            if (htab[i] === fcode) {
              ent = codetab[i];
              continue outer_loop;
            }
          } while (htab[i] >= 0);
        }
        output(ent, outs);
        ent = c;
        if (free_ent < 4096) {
          codetab[i] = free_ent++;
          htab[i] = fcode;
        } else {
          cl_block(outs);
        }
      }
      output(ent, outs);
      output(EOFCode, outs);
    }

    function flush_char(outs) {
      if (a_count > 0) {
        outs.writeByte(a_count);
        outs.writeBytes(accum, 0, a_count);
        a_count = 0;
      }
    }

    function nextPixel() {
      if (remaining === 0) return -1;
      --remaining;
      var pix = pixels[curPixel++];
      return pix & 0xff;
    }

    function output(code, outs) {
      cur_accum &= (1 << cur_bits) - 1;
      if (cur_bits > 0) cur_accum |= code << cur_bits;
      else cur_accum = code;
      cur_bits += n_bits;
      while (cur_bits >= 8) {
        char_out(cur_accum & 0xff, outs);
        cur_accum >>= 8;
        cur_bits -= 8;
      }
      if (free_ent > maxcode || clear_flg) {
        if (clear_flg) {
          maxcode = (1 << (n_bits = g_init_bits)) - 1;
          clear_flg = false;
        } else {
          ++n_bits;
          if (n_bits == 12) maxcode = 4096;
          else maxcode = (1 << n_bits) - 1;
        }
      }
      if (code == EOFCode) {
        while (cur_bits > 0) {
          char_out(cur_accum & 0xff, outs);
          cur_accum >>= 8;
          cur_bits -= 8;
        }
        flush_char(outs);
      }
    }

    return {
      encode: function(outs) {
        cur_accum = 0;
        cur_bits = 0;
        remaining = width * height;
        curPixel = 0;
        outs.writeByte(initCodeSize);
        compress(initCodeSize + 1, outs);
        outs.writeByte(0);
      }
    };
  };

  // GIF Encoder
  GIFEncoder = function(width, height) {
    var out, image, pixels, indexedPixels, colorDepth, colorTab, usedEntry = [];
    var palSize = 7, dispose = -1, repeat = 0, transparent = null, delay = 0;
    var sample = 10;

    function analyzePixels() {
      var len = pixels.length, nPix = len / 3;
      indexedPixels = new Uint8Array(nPix);
      var nq = new NeuQuant(pixels, sample);
      colorTab = nq.process();
      var k = 0;
      for (var i = 0; i < nPix; i++) {
        var index = nq.map(pixels[k++] & 0xff, pixels[k++] & 0xff, pixels[k++] & 0xff);
        usedEntry[index] = true;
        indexedPixels[i] = index;
      }
      pixels = null;
      colorDepth = 8;
      palSize = 7;
    }

    function writeGraphicCtrlExt() {
      out.writeByte(0x21);
      out.writeByte(0xf9);
      out.writeByte(4);
      var transp, disp;
      if (transparent === null) {
        transp = 0;
        disp = 0;
      } else {
        transp = 1;
        disp = 2;
      }
      if (dispose >= 0) disp = dispose & 7;
      disp <<= 2;
      out.writeByte(disp | transp);
      writeShort(delay);
      out.writeByte(transparent === null ? 0 : transparent);
      out.writeByte(0);
    }

    function writeImageDesc() {
      out.writeByte(0x2c);
      writeShort(0);
      writeShort(0);
      writeShort(width);
      writeShort(height);
      out.writeByte(0x80 | palSize);
    }

    function writeLSD() {
      writeShort(width);
      writeShort(height);
      out.writeByte(0x80 | 0x70 | palSize);
      out.writeByte(0);
      out.writeByte(0);
    }

    function writeNetscapeExt() {
      out.writeByte(0x21);
      out.writeByte(0xff);
      out.writeByte(11);
      out.writeString('NETSCAPE2.0');
      out.writeByte(3);
      out.writeByte(1);
      writeShort(repeat);
      out.writeByte(0);
    }

    function writePalette() {
      out.writeBytes(colorTab);
      var n = 3 * 256 - colorTab.length;
      for (var i = 0; i < n; i++) out.writeByte(0);
    }

    function writePixels() {
      var enc = new LZWEncoder(width, height, indexedPixels, colorDepth);
      enc.encode(out);
    }

    function writeShort(val) {
      out.writeByte(val & 0xff);
      out.writeByte((val >> 8) & 0xff);
    }

    function writeString(s) {
      for (var i = 0; i < s.length; i++) out.writeByte(s.charCodeAt(i));
    }

    return {
      setDelay: function(d) { delay = Math.round(d / 10); },
      setRepeat: function(r) { repeat = r; },
      setTransparent: function(c) { transparent = c; },
      setQuality: function(q) { if (q < 1) q = 1; sample = q; },
      setDispose: function(d) { dispose = d; },
      addFrame: function(imageData) {
        image = imageData;
        pixels = new Uint8Array(width * height * 3);
        for (var i = 0, j = 0; i < imageData.length; i += 4) {
          pixels[j++] = imageData[i];
          pixels[j++] = imageData[i + 1];
          pixels[j++] = imageData[i + 2];
        }
        analyzePixels();
        writeGraphicCtrlExt();
        writeImageDesc();
        writePalette();
        writePixels();
      },
      start: function(output) {
        out = output;
        out.writeString('GIF89a');
        writeLSD();
        writeNetscapeExt();
      },
      finish: function() {
        out.writeByte(0x3b);
      }
    };
  };

  // ByteArray output stream
  function ByteArray() {
    var data = [];
    return {
      writeByte: function(b) { data.push(b); },
      writeBytes: function(arr, offset, length) {
        offset = offset || 0;
        length = length || arr.length;
        for (var i = offset; i < offset + length; i++) data.push(arr[i]);
      },
      writeString: function(s) {
        for (var i = 0; i < s.length; i++) data.push(s.charCodeAt(i));
      },
      getData: function() { return new Uint8Array(data); }
    };
  }

  // Worker message handler
  self.onmessage = function(e) {
    var data = e.data;

    if (data.type === 'start') {
      var encoder = new GIFEncoder(data.width, data.height);
      var stream = new ByteArray();
      encoder.setRepeat(0);
      encoder.setQuality(data.quality || 10);
      encoder.setDelay(data.delay);
      encoder.start(stream);

      self.encoder = encoder;
      self.stream = stream;
      self.frameIndex = 0;
    } else if (data.type === 'frame') {
      self.encoder.addFrame(data.data);
      self.frameIndex++;
      self.postMessage({ type: 'progress', progress: self.frameIndex / data.total });
    } else if (data.type === 'finish') {
      self.encoder.finish();
      var output = self.stream.getData();
      self.postMessage({ type: 'finished', data: output.buffer }, [output.buffer]);
    }
  };
})();
