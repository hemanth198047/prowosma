package com.prowosma.backend.integration;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Just enough JSON to read the sample payloads in these tests, so they can be pasted verbatim. */
final class TinyJson {
    private final String s;
    private int i;

    private TinyJson(String s) { this.s = s; }

    @SuppressWarnings("unchecked")
    static Map<String, Object> object(String json) {
        Object v = new TinyJson(json).value();
        return (Map<String, Object>) v;
    }

    private Object value() {
        ws();
        char c = s.charAt(i);
        if (c == '{') return obj();
        if (c == '[') return arr();
        if (c == '"') return str();
        if (s.startsWith("true", i))  { i += 4; return Boolean.TRUE; }
        if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
        if (s.startsWith("null", i))  { i += 4; return null; }
        int start = i;
        while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
        String num = s.substring(start, i);
        return num.contains(".") || num.contains("e") || num.contains("E") ? (Object) Double.valueOf(num) : (Object) Long.valueOf(num);
    }

    private Map<String, Object> obj() {
        Map<String, Object> m = new LinkedHashMap<>();
        i++; ws();
        if (s.charAt(i) == '}') { i++; return m; }
        while (true) {
            ws(); String k = str(); ws(); i++;          // ':'
            m.put(k, value()); ws();
            if (s.charAt(i++) == '}') return m;         // ',' or '}'
        }
    }

    private List<Object> arr() {
        List<Object> l = new ArrayList<>();
        i++; ws();
        if (s.charAt(i) == ']') { i++; return l; }
        while (true) {
            l.add(value()); ws();
            if (s.charAt(i++) == ']') return l;
        }
    }

    private String str() {
        StringBuilder sb = new StringBuilder();
        i++;
        while (s.charAt(i) != '"') {
            char c = s.charAt(i++);
            if (c == '\\') {
                char e = s.charAt(i++);
                switch (e) {
                    case 'n': sb.append('\n'); break;
                    case 't': sb.append('\t'); break;
                    case 'u': sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                    default:  sb.append(e);
                }
            } else sb.append(c);
        }
        i++;
        return sb.toString();
    }

    private void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
}
