# bbpPairings Makefile (mirror of upstream v6.0.0)
# https://github.com/BieremaBoyzProgramming/bbpPairings
#
# Usage:
#   make static=yes dutch=yes burstein=yes engine_comparison=yes
#
# This is a placeholder. Replace with the actual Makefile from:
# https://raw.githubusercontent.com/BieremaBoyzProgramming/bbpPairings/master/Makefile
#
# The build script (server/scripts/build.sh) will use this Makefile
# to compile bbpPairings from source during deployment.

SRC = src
OBJ = build
SOURCES = $(shell find $(SRC) -name "*.cpp")
OBJECTS = $(patsubst $(SRC)/%.cpp, $(OBJ)/%.o, $(SOURCES))

burstein = yes
dutch = yes
engine_comparison = yes
static = no
optimize = yes
debug = no
COMP = gcc

ifeq ($(COMP), gcc)
  CXX = g++
else ifeq ($(COMP), clang)
  CXX = clang++
endif

CXXFLAGS = -std=c++20 -O2 -DNDEBUG

ifeq ($(static), yes)
  LDFLAGS += -static
endif

ifeq ($(dutch), yes)
  CXXFLAGS += -DINCLUDE_DUTCH
endif

ifeq ($(burstein), yes)
  CXXFLAGS += -DINCLUDE_BURSTEIN
endif

ifeq ($(engine_comparison), yes)
  CXXFLAGS += -DINCLUDE_ENGINE_COMPARISON
endif

TARGET = bbpPairings.exe

all: $(TARGET)

$(TARGET): $(OBJECTS)
	$(CXX) $(CXXFLAGS) $(LDFLAGS) -o $@ $^

$(OBJ)/%.o: $(SRC)/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -c -o $@ $<

clean:
	rm -rf $(OBJ) $(TARGET)

.PHONY: all clean
