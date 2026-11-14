// params.cpp: a small JSON reader, enough for chain_params (an array of flat
// objects whose values are strings, numbers, booleans or arrays of those).
#include "params.h"

#include <cctype>
#include <cstdlib>
#include <map>

#include "classes.h"

#include <fstream>
#include <mutex>
#include <sstream>

namespace schwung {
namespace {

struct Val {
    enum Kind { Null, Num, Str, Arr, Obj, Bool } kind = Null;
    double num = 0;
    std::string str;
    std::vector<Val> arr;
    std::map<std::string, Val> obj;
};

struct Parser {
    const std::string& s;
    size_t i = 0;
    explicit Parser(const std::string& in) : s(in) {}
    void ws() { while (i < s.size() && std::isspace((unsigned char)s[i])) i++; }
    bool parse(Val& v) {
        ws();
        if (i >= s.size()) return false;
        char c = s[i];
        if (c == '{') return obj(v);
        if (c == '[') return arr(v);
        if (c == '"') { v.kind = Val::Str; return string(v.str); }
        if (c == 't' && s.compare(i, 4, "true") == 0) { v.kind = Val::Bool; v.num = 1; i += 4; return true; }
        if (c == 'f' && s.compare(i, 5, "false") == 0) { v.kind = Val::Bool; i += 5; return true; }
        if (c == 'n' && s.compare(i, 4, "null") == 0) { v.kind = Val::Null; i += 4; return true; }
        char* end = nullptr;
        v.num = std::strtod(s.c_str() + i, &end);
        if (end == s.c_str() + i) return false;
        v.kind = Val::Num;
        i = (size_t)(end - s.c_str());
        return true;
    }
    bool string(std::string& out) {
        i++; // "
        while (i < s.size() && s[i] != '"') {
            if (s[i] == '\\' && i + 1 < s.size()) {
                char e = s[++i];
                switch (e) {
                case 'n': out += '\n'; break;
                case 't': out += '\t'; break;
                case 'u': out += '?'; i += 4; break; // ASCII only on the Push
                default: out += e;
                }
                i++;
                continue;
            }
            out += s[i++];
        }
        i++;
        return true;
    }
    bool arr(Val& v) {
        v.kind = Val::Arr;
        i++;
        ws();
        if (i < s.size() && s[i] == ']') { i++; return true; }
        for (;;) {
            Val e;
            if (!parse(e)) return false;
            v.arr.push_back(std::move(e));
            ws();
            if (i < s.size() && s[i] == ',') { i++; continue; }
            if (i < s.size() && s[i] == ']') { i++; return true; }
            return false;
        }
    }
    bool obj(Val& v) {
        v.kind = Val::Obj;
        i++;
        ws();
        if (i < s.size() && s[i] == '}') { i++; return true; }
        for (;;) {
            ws();
            std::string k;
            if (i >= s.size() || s[i] != '"' || !string(k)) return false;
            ws();
            if (i >= s.size() || s[i] != ':') return false;
            i++;
            Val e;
            if (!parse(e)) return false;
            v.obj[k] = std::move(e);
            ws();
            if (i < s.size() && s[i] == ',') { i++; continue; }
            if (i < s.size() && s[i] == '}') { i++; return true; }
            return false;
        }
    }
};

std::string strOf(const Val& o, const char* k) {
    auto it = o.obj.find(k);
    return it != o.obj.end() && it->second.kind == Val::Str ? it->second.str : "";
}
bool numOf(const Val& o, const char* k, double& out) {
    auto it = o.obj.find(k);
    if (it == o.obj.end()) return false;
    if (it->second.kind == Val::Num) { out = it->second.num; return true; }
    if (it->second.kind == Val::Str) {
        char* end = nullptr;
        out = std::strtod(it->second.str.c_str(), &end);
        return end != it->second.str.c_str();
    }
    return false;
}

} // namespace

std::vector<ParamMeta> parseChainParams(const std::string& json) {
    std::vector<ParamMeta> out;
    Val root;
    Parser p(json);
    if (!p.parse(root) || root.kind != Val::Arr) return out;
    for (const Val& o : root.arr) {
        if (o.kind != Val::Obj) continue;
        ParamMeta m;
        m.key = strOf(o, "key");
        if (m.key.empty()) continue;
        m.name = strOf(o, "name");
        if (m.name.empty()) m.name = strOf(o, "label");
        if (m.name.empty()) m.name = m.key;
        m.type = strOf(o, "type");
        m.unit = strOf(o, "unit");
        m.format = strOf(o, "display_format");
        numOf(o, "min", m.min);
        numOf(o, "max", m.max);
        numOf(o, "step", m.step);
        m.hasDefault = numOf(o, "default", m.def);
        auto opts = o.obj.find("options");
        if (opts != o.obj.end() && opts->second.kind == Val::Arr)
            for (const Val& x : opts->second.arr)
                if (x.kind == Val::Str) m.options.push_back(x.str);
        if (m.type.empty()) m.type = m.options.empty() ? "float" : "enum";
        if (m.type == "enum" && m.options.empty()) continue;           // cannot be stepped honestly
        if ((m.type == "float" || m.type == "int") && m.max <= m.min) continue; // no range
        if (m.type != "float" && m.type != "int" && m.type != "enum") continue;  // strings, paths
        out.push_back(std::move(m));
    }
    return out;
}

} // namespace schwung

namespace schwung {
namespace {

ParamMeta metaFromVal(const Val& o) {
    ParamMeta m;
    m.key = strOf(o, "key");
    m.name = strOf(o, "name");
    m.type = strOf(o, "type");
    m.unit = strOf(o, "unit");
    m.format = strOf(o, "format");
    numOf(o, "min", m.min);
    numOf(o, "max", m.max);
    double d;
    if (numOf(o, "default", d)) { m.def = d; m.hasDefault = true; } // normalized
    auto opts = o.obj.find("options");
    if (opts != o.obj.end() && opts->second.kind == Val::Arr)
        for (const Val& x : opts->second.arr)
            if (x.kind == Val::Str) m.options.push_back(x.str);
    return m;
}

} // namespace

std::string classesPath() {
    if (const char* e = std::getenv("SCHWUNG_CLASSES"); e && *e) return e;
    return "/data/push-hack/hacks/schwung/vst3-classes.json";
}

const std::vector<ClassInfo>& classes() {
    static std::vector<ClassInfo> out;
    static std::once_flag once;
    std::call_once(once, [] {
        std::ifstream f(classesPath());
        if (!f) return;
        std::stringstream ss;
        ss << f.rdbuf();
        std::string doc = ss.str();
        Val root;
        Parser p(doc);
        if (!p.parse(root) || root.kind != Val::Obj) return;
        auto cl = root.obj.find("classes");
        if (cl == root.obj.end() || cl->second.kind != Val::Arr) return;
        for (const Val& c : cl->second.arr) {
            if (c.kind != Val::Obj) continue;
            ClassInfo ci;
            ci.uid = strOf(c, "uid");
            ci.name = strOf(c, "name");
            ci.kind = strOf(c, "kind");
            ci.category = strOf(c, "category");
            if (ci.uid.size() != 32 || ci.name.empty()) continue;
            auto ps = c.obj.find("params");
            if (ps != c.obj.end() && ps->second.kind == Val::Arr)
                for (const Val& x : ps->second.arr)
                    if (x.kind == Val::Obj) ci.params.push_back(metaFromVal(x));
            auto bs = c.obj.find("banks");
            if (bs != c.obj.end() && bs->second.kind == Val::Arr)
                for (const Val& b : bs->second.arr) {
                    std::vector<int> row;
                    if (b.kind == Val::Arr)
                        for (const Val& i : b.arr)
                            if (i.kind == Val::Num) row.push_back((int)i.num);
                    ci.banks.push_back(row);
                }
            out.push_back(std::move(ci));
        }
    });
    return out;
}

bool parseReply(const std::string& line, Reply& r) {
    Val v;
    Parser p(line);
    if (!p.parse(v) || v.kind != Val::Obj) return false;
    auto ok = v.obj.find("ok");
    r.ok = ok != v.obj.end() && ok->second.kind == Val::Bool && ok->second.num != 0;
    double id = 0;
    if (numOf(v, "id", id)) r.id = (int)id;
    r.shm = strOf(v, "shm");
    r.state = strOf(v, "state");
    r.error = strOf(v, "error");
    return true;
}

std::string jsonString(const std::string& s) {
    std::string o = "\"";
    for (unsigned char c : s) {
        switch (c) {
        case '"': o += "\\\""; break;
        case '\\': o += "\\\\"; break;
        case '\n': o += "\\n"; break;
        case '\t': o += "\\t"; break;
        case '\r': o += "\\r"; break;
        default:
            if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
            else o += (char)c;
        }
    }
    return o + "\"";
}

} // namespace schwung
