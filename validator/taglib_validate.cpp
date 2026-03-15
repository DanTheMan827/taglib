/**
 * taglib_validate.cpp
 *
 * Reads an audio file using C TagLib and outputs JSON with tag info,
 * audio properties, and picture metadata. Used for cross-validation
 * with taglib-ts output.
 *
 * Usage: taglib_validate <filepath>
 * Output: JSON to stdout
 */
#include <cctype>
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>

#include <taglib/fileref.h>
#include <taglib/tag.h>
#include <taglib/audioproperties.h>
#include <taglib/flacfile.h>
#include <taglib/flacpicture.h>
#include <taglib/vorbisfile.h>
#include <taglib/xiphcomment.h>
#include <taglib/mpegfile.h>
#include <taglib/id3v2tag.h>
#include <taglib/attachedpictureframe.h>
#include <taglib/mp4file.h>
#include <taglib/mp4tag.h>
#include <taglib/mp4coverart.h>
#include <taglib/wavfile.h>
#include <taglib/aifffile.h>

// Escape a UTF-8 string for JSON output
static std::string jsonEscape(const std::string &s) {
  std::ostringstream out;
  for (unsigned char c : s) {
    if (c == '"') out << "\\\"";
    else if (c == '\\') out << "\\\\";
    else if (c == '\n') out << "\\n";
    else if (c == '\r') out << "\\r";
    else if (c == '\t') out << "\\t";
    else if (c < 0x20) {
      char buf[8];
      snprintf(buf, sizeof(buf), "\\u%04x", c);
      out << buf;
    } else {
      out << c;
    }
  }
  return out.str();
}

static std::string toLower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), ::tolower);
  return s;
}

static std::string getExt(const std::string &path) {
  auto pos = path.rfind('.');
  if (pos == std::string::npos) return "";
  return toLower(path.substr(pos));
}

struct PictureInfo {
  std::string mimeType;
  std::string description;
  int type = 0;
  int size = 0;
};

static std::vector<PictureInfo> getPictures(const std::string &path) {
  std::vector<PictureInfo> pics;
  const std::string ext = getExt(path);

  if (ext == ".flac") {
    TagLib::FLAC::File f(path.c_str());
    if (f.isValid()) {
      for (auto *p : f.pictureList()) {
        PictureInfo pi;
        pi.mimeType = p->mimeType().toCString(true);
        pi.description = p->description().toCString(true);
        pi.type = static_cast<int>(p->type());
        pi.size = static_cast<int>(p->data().size());
        pics.push_back(pi);
      }
    }
  } else if (ext == ".ogg") {
    TagLib::Ogg::Vorbis::File f(path.c_str());
    if (f.isValid() && f.tag()) {
      for (auto *p : f.tag()->pictureList()) {
        PictureInfo pi;
        pi.mimeType = p->mimeType().toCString(true);
        pi.description = p->description().toCString(true);
        pi.type = static_cast<int>(p->type());
        pi.size = static_cast<int>(p->data().size());
        pics.push_back(pi);
      }
    }
  } else if (ext == ".mp3") {
    TagLib::MPEG::File f(path.c_str());
    if (f.isValid() && f.ID3v2Tag()) {
      const auto &frameList = f.ID3v2Tag()->frameListMap()["APIC"];
      for (auto *frame : frameList) {
        auto *apic = dynamic_cast<TagLib::ID3v2::AttachedPictureFrame *>(frame);
        if (apic) {
          PictureInfo pi;
          pi.mimeType = apic->mimeType().toCString(true);
          pi.description = apic->description().toCString(true);
          pi.type = static_cast<int>(apic->type());
          pi.size = static_cast<int>(apic->picture().size());
          pics.push_back(pi);
        }
      }
    }
  } else if (ext == ".m4a" || ext == ".mp4" || ext == ".aac") {
    TagLib::MP4::File f(path.c_str());
    if (f.isValid() && f.tag() && f.tag()->contains("covr")) {
      auto coverList = f.tag()->item("covr").toCoverArtList();
      for (const auto &cover : coverList) {
        PictureInfo pi;
        if (cover.format() == TagLib::MP4::CoverArt::JPEG)
          pi.mimeType = "image/jpeg";
        else if (cover.format() == TagLib::MP4::CoverArt::PNG)
          pi.mimeType = "image/png";
        else
          pi.mimeType = "image/unknown";
        pi.size = static_cast<int>(cover.data().size());
        pi.type = 3; // FrontCover
        pics.push_back(pi);
      }
    }
  } else if (ext == ".wav") {
    TagLib::RIFF::WAV::File f(path.c_str());
    if (f.isValid() && f.ID3v2Tag()) {
      const auto &frameList = f.ID3v2Tag()->frameListMap()["APIC"];
      for (auto *frame : frameList) {
        auto *apic = dynamic_cast<TagLib::ID3v2::AttachedPictureFrame *>(frame);
        if (apic) {
          PictureInfo pi;
          pi.mimeType = apic->mimeType().toCString(true);
          pi.description = apic->description().toCString(true);
          pi.type = static_cast<int>(apic->type());
          pi.size = static_cast<int>(apic->picture().size());
          pics.push_back(pi);
        }
      }
    }
  } else if (ext == ".aif" || ext == ".aiff") {
    TagLib::RIFF::AIFF::File f(path.c_str());
    if (f.isValid() && f.tag()) {
      const auto &frameList = f.tag()->frameListMap()["APIC"];
      for (auto *frame : frameList) {
        auto *apic = dynamic_cast<TagLib::ID3v2::AttachedPictureFrame *>(frame);
        if (apic) {
          PictureInfo pi;
          pi.mimeType = apic->mimeType().toCString(true);
          pi.description = apic->description().toCString(true);
          pi.type = static_cast<int>(apic->type());
          pi.size = static_cast<int>(apic->picture().size());
          pics.push_back(pi);
        }
      }
    }
  }

  return pics;
}

int main(int argc, char *argv[]) {
  if (argc < 2) {
    std::cout << R"({"valid":false})" << std::endl;
    return 1;
  }

  const std::string path = argv[1];
  TagLib::FileRef f(path.c_str());

  if (f.isNull() || !f.tag()) {
    std::cout << R"({"valid":false})" << std::endl;
    return 0;
  }

  auto *tag = f.tag();
  auto *ap = f.audioProperties();
  auto pictures = getPictures(path);

  std::ostringstream json;
  json << "{";
  json << "\"valid\":true,";
  json << "\"title\":\"" << jsonEscape(tag->title().toCString(true)) << "\",";
  json << "\"artist\":\"" << jsonEscape(tag->artist().toCString(true)) << "\",";
  json << "\"album\":\"" << jsonEscape(tag->album().toCString(true)) << "\",";
  json << "\"comment\":\"" << jsonEscape(tag->comment().toCString(true)) << "\",";
  json << "\"genre\":\"" << jsonEscape(tag->genre().toCString(true)) << "\",";
  json << "\"year\":" << tag->year() << ",";
  json << "\"track\":" << tag->track();

  if (ap) {
    json << ",\"duration\":" << ap->length();
    json << ",\"durationMs\":" << ap->lengthInMilliseconds();
    json << ",\"bitrate\":" << ap->bitrate();
    json << ",\"sampleRate\":" << ap->sampleRate();
    json << ",\"channels\":" << ap->channels();
  }

  json << ",\"pictureCount\":" << pictures.size();

  if (!pictures.empty()) {
    json << ",\"pictures\":[";
    for (size_t i = 0; i < pictures.size(); ++i) {
      if (i > 0) json << ",";
      const auto &p = pictures[i];
      json << "{";
      json << "\"mimeType\":\"" << jsonEscape(p.mimeType) << "\",";
      json << "\"description\":\"" << jsonEscape(p.description) << "\",";
      json << "\"type\":" << p.type << ",";
      json << "\"size\":" << p.size;
      json << "}";
    }
    json << "]";
  }

  json << "}";
  std::cout << json.str() << std::endl;
  return 0;
}
