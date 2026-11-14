# Schwung.vst3: Schwung modules as Live devices (DESIGN-v2). Spike 1.
cmake_minimum_required(VERSION 3.19)
project(SchwungVST3 VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The SDK, without its GUI library, examples or symlinks into ~/.vst3. Of
# the hosting examples only Steinberg's `validator` is built (the others need
# X11, and nothing here has a GUI).
set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
set(SMTG_CREATE_PLUGIN_LINK OFF CACHE BOOL "" FORCE)
set(SMTG_RUN_VST_VALIDATOR OFF CACHE BOOL "" FORCE)
# No moduleinfo.json: the classes come from the installed modules at load time
# (vst3-classes.json), so a file written at build time would list none, and a
# host that trusts it would see no Schwung device at all.
set(SMTG_CREATE_MODULE_INFO OFF CACHE BOOL "" FORCE)
set(VST3SDK ${CMAKE_CURRENT_SOURCE_DIR}/../third_party/vst3sdk)
add_subdirectory(${VST3SDK} ${PROJECT_BINARY_DIR}/vst3sdk)
smtg_enable_vst3_sdk()

smtg_add_vst3plugin(Schwung
    source/proxy.cpp
    source/params.cpp
)
# schwung_ipc.h: the shared-memory layout, shared with the Schwung service
target_include_directories(Schwung PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../src)
target_link_libraries(Schwung PRIVATE sdk pthread)

# playtest: hosts the plugin like Live and checks real sound through the service
add_executable(schwung_playtest test/playtest.cpp
    ${VST3SDK}/public.sdk/source/vst/hosting/module.cpp
    ${VST3SDK}/public.sdk/source/vst/hosting/module_linux.cpp
    ${VST3SDK}/public.sdk/source/vst/hosting/plugprovider.cpp
    ${VST3SDK}/public.sdk/source/vst/hosting/connectionproxy.cpp
    ${VST3SDK}/public.sdk/source/vst/moduleinfo/moduleinfoparser.cpp
    ${VST3SDK}/public.sdk/source/common/memorystream.cpp)
target_link_libraries(schwung_playtest PRIVATE sdk_hosting)
