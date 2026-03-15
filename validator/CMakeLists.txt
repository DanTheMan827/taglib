cmake_minimum_required(VERSION 3.12)
project(TagLibValidator CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(PkgConfig REQUIRED)
pkg_check_modules(TAGLIB REQUIRED taglib)

include_directories(${TAGLIB_INCLUDE_DIRS})
link_directories(${TAGLIB_LIBRARY_DIRS})

add_executable(taglib_validate taglib_validate.cpp)
target_link_libraries(taglib_validate PRIVATE ${TAGLIB_LIBRARIES})
target_compile_options(taglib_validate PRIVATE ${TAGLIB_CFLAGS_OTHER})

add_executable(tag_with_c_full tag_with_c_full.cpp)
target_link_libraries(tag_with_c_full PRIVATE ${TAGLIB_LIBRARIES})
target_compile_options(tag_with_c_full PRIVATE ${TAGLIB_CFLAGS_OTHER})
