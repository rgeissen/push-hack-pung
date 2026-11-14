// classes.h: the Schwung device classes, from the service's vst3-classes.json.
//
// The plugin never loads module code: Live sees one class per installed module
// (read from the file), and the module runs in the Schwung service.
#pragma once

#include "params.h"

#include <string>
#include <vector>

namespace schwung {

struct ClassInfo {
    std::string uid;      // 32 hex digits
    std::string name;     // "Schwung Braids"
    std::string kind;     // instrument | effect | midi
    std::string category; // VST3 sub categories
    std::vector<ParamMeta> params;
    std::vector<std::vector<int>> banks;
};

// One answer from the service's control socket.
struct Reply {
    bool ok = false;
    int id = 0;
    std::string shm, state, error;
};
bool parseReply(const std::string& line, Reply& r);
std::string jsonString(const std::string& s); // quoted and escaped

// $SCHWUNG_CLASSES, else the service's file on the Push.
std::string classesPath();
const std::vector<ClassInfo>& classes();

} // namespace schwung
