cmake_minimum_required(VERSION 3.14)
project(TheAnomaly LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release)
endif()

# GLFW e GLM são baixados automaticamente na primeira configuração do CMake
include(FetchContent)

set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GLFW_INSTALL OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_WAYLAND OFF CACHE BOOL "" FORCE)

FetchContent_Declare(glfw
    URL https://github.com/glfw/glfw/archive/refs/tags/3.4.tar.gz)
FetchContent_Declare(glm
    URL https://github.com/g-truc/glm/archive/refs/tags/1.0.1.tar.gz)
FetchContent_MakeAvailable(glfw glm)

add_library(glad STATIC external/glad/src/glad.c)
target_include_directories(glad PUBLIC external/glad/include)
target_link_libraries(glad PUBLIC ${CMAKE_DL_LIBS})

add_executable(anomaly
    src/main.cpp
    src/shader.cpp
    src/geometry.cpp
    src/framebuffer.cpp
    src/story.cpp
    src/texture.cpp
)
target_link_libraries(anomaly PRIVATE glad glfw glm::glm)
# stb_image (carregamento de imagens) é um único header, incluído em external/stb
target_include_directories(anomaly SYSTEM PRIVATE external/stb)

# No MinGW, embute as bibliotecas de C++ no executável para não depender
# de DLLs (libstdc++, libgcc) de outra versão que estejam no PATH
if(MINGW)
    target_link_options(anomaly PRIVATE -static)
endif()

# Os shaders são lidos direto da pasta do projeto, então podem ser editados sem recompilar
target_compile_definitions(anomaly PRIVATE
    SHADER_DIR="${CMAKE_SOURCE_DIR}/shaders/"
    ASSET_DIR="${CMAKE_SOURCE_DIR}/assets/")
