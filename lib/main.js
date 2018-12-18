/**
 * rebrand: Node.js based chromium devtools for rebranding chromium.
 *
 * @see https://github.com/zhsoft88/rebrand
 *
 * @author zhsoft88 <zhsoft88@icloud.com> (https://github.com/zhsoft88)
 * @copyright © 2018 zhuatang.com
 * @license MIT
 */

const FS = require('fs')
const PATH = require('path')
const {tranid} = require('tranid')
const {JSDOM} = require('jsdom')
const md5 = require('md5')

var chrome_src
var config_dir

function log(mesg) {
  console.log(mesg)
}

function error(mesg) {
  console.error(`Error: ${mesg}`)
}

function warn(mesg) {
  console.error(`Warning: ${mesg}`)
}

function error_exit(mesg) {
  error(mesg)
  process.exit(1)
}

function is_whitespace(ch) {
  return /\s/.test(ch)
}

function skip_whitespace(buf, len, i) {
  while (i < len && is_whitespace(buf[i])) {
    i++
  }
  return i
}

function parse_args() {
  const result =  {
    help: false,
    version: false,
    chrome_src: null,
    argv: [],
  }
  const chrome_src_prefix = '--chrome_src'
  const len = process.argv.length
  let i = 2
  if (i == len) {
    result.help = true
    return result
  }

  while (i < len) {
    // get options
    const arg = process.argv[i]
    if (arg == '--help' || arg == '-h') {
      result.help = true
      break
    }

    if (arg == '--version' || arg == '-v') {
      result.version = true
      break
    }

    if (arg == '-c') {
      i++
      if (i == len)
        error_exit(`no argument specified for ${arg}`)

      result.chrome_src = process.argv[i]
      i++
      continue
    }

    if (arg == chrome_src_prefix || arg.startsWith(chrome_src_prefix + '=')) {
      if (arg == chrome_src_prefix || arg == chrome_src_prefix + '=')
        error_exit(`no argument specified for ${chrome_src_prefix}`)

      const path = arg.substr(chrome_src_prefix.length + 1)
      result.chrome_src = path
      i++
      continue
    }

    result.argv = process.argv.slice(i)
    break
  }
  return result
}

function usage() {
  log(
`Node.js based chromium devtools for rebranding chromium

Usage:
  rebrand [OPTIONS] [config_dir]

Options:
  -h, --help: Help
  -v, --version : Version
  -c DIR, --chrome_src=DIR : Chromium source dir
`)
}

function help_exit() {
  usage()
  process.exit(0)
}

function find_chrome_src() {
  let dir = PATH.resolve('.')
  const cv = 'chrome/VERSION'
  if (FS.existsSync(cv))
    return dir

  const root = PATH.parse(process.cwd()).root
  do {
    dir = PATH.resolve(PATH.join(dir, '..'))
    const path = PATH.join(dir, cv)
    if (FS.existsSync(path))
      return dir

    if (dir == root)
      return null
  } while (true)
}

function parse_grd(file) {
  const content = FS.readFileSync(file, 'utf8')
  const dom = new JSDOM(content)
  const dir = PATH.dirname(file)
  const result = {}
  {
    const xtb_files = []
    const list = dom.window.document.querySelectorAll(`grit > translations file[path]`)
    for (const elem of list) {
      const path = PATH.join(dir, elem.getAttribute('path'))
      xtb_files.push(path)
    }
    Object.assign(result, {xtb_files})
  }
  {
    const part_files = []
    const list = dom.window.document.querySelectorAll(`grit > release part[file]`)
    for (const elem of list) {
      const path = PATH.join(dir, elem.getAttribute('file'))
      part_files.push(path)
    }
    Object.assign(result, {part_files})
  }
  return result
}

function is_dir(path) {
  try {
    return FS.statSync(path).isDirectory();
  } catch(e) {}
  return false;
}

function map_from_file(file) {
  const map = new Map
  const lines = FS.readFileSync(file, 'utf8').split('\n')
  for (const line of lines) {
    const [key, value] = line.trim().split('=')
    if (key.length == 0)
      continue

    map.set(key, value)
  }
  return map
}

function escape_pattern(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function filter_file_contents(file, replace_list) {
  let contents = FS.readFileSync(file, 'utf8')
  for (const [key, value] of replace_list) {
    const regex = new RegExp(escape_pattern(key), 'g')
    contents = contents.replace(regex, value)
  }
  FS.writeFileSync(file, contents)
}

function tranid_list_from_file(file) {
  const contents = FS.readFileSync(file, 'utf8')
  const [list] = tranid(contents, [])
  return list
}

// replace tranid and remove duplicated translation
function replace_tranid_in_xtb(file, id_map) {
  const contents = FS.readFileSync(file, 'utf8')
  let output = ''
  let found = false
  const len = contents.length
  const starttag = '<translation '
  const endtag = '</translation>'
  const regexp = new RegExp(`\s*id="(?<id>[^"]*)"`)
  const all_ids = []
  let i = 0
  while (i < len) {
    // get until <translation
    while (i < len && !contents.startsWith(starttag, i)) {
      output += contents[i]
      i++
    }
    if (i == len)
      break

    // get line until >
    let line = ''
    while (i < len && contents[i] != '>') {
      line += contents[i]
      i++
    }
    if (i != len) {
      // skip >
      line += contents[i]
      i++
    }

    // filter line with id
    const obj = regexp.exec(line)
    if (obj && obj.groups && obj.groups.id) {
      const id = obj.groups.id
      const new_id = id_map.has(id) ? id_map.get(id) : id
      if (all_ids.includes(new_id)) {
        // skip to </translation>, ignore this dup id
        // warn(`ignore dup id ${new_id}`)
        while (i < len && !contents.startsWith(endtag, i)) {
          i++
        }
        if (i != len) {
          i += endtag.length
        }
        continue
      }

      if (id_map.has(id)) {
        found = true
        line = line.replace(id, new_id)
      }
      all_ids.push(new_id)
    }
    output += line
  }
  if (found) {
    FS.writeFileSync(file, output)
  }
}

function grdxtb_replace_contents(contents, replace_list) {
  function replace_text(text) {
    for (const [k, v] of replace_list) {
      const ek = escape_pattern(k)
      const regex = new RegExp(String.raw`\b${ek}\b`, 'g')
      text = text.replace(regex, v)
    }
    return text
  }
  let result = ''
  let found = ''
  const size = contents.length
  let i = 0
  while (i < size) {
    // skip to <
    let text = ''
    while (i < size && contents[i] != '<') {
      text += contents[i]
      i++
    }
    const filter_text = found.length > 0 ? replace_text(text) : text
    result += filter_text
    if (i == size)
      break

    // get until > or />
    let element = ''
    while (i < size && contents[i] != '>' && !contents.startsWith('/>', i)) {
      element += contents[i]
      i++
    }
    if (i != size) {
      if (contents[i] == '>') {
        element += '>'
        i++
      } else {
        element += '/>'
        i += 2
      }
    }
    result += element
    if (i == size)
      break

    if (found.length > 0) {
      if (element == '/' + found) {
        found = ''
      }
    } else {
      if (element.startsWith('<message ') || element == '<message>') {
        found = 'message'
      } else if (element.startsWith('<translation ') || element == '<translation>') {
        found = 'translation'
      }
    }
  }
  return result
}

function get_chrome_src(args) {
  let chrome_src
  if (args.chrome_src) {
    chrome_src = PATH.resolve(args.chrome_src)
    if (!FS.existsSync(PATH.join(chrome_src, 'chrome/VERSION')))
      return null
  } else {
    chrome_src = find_chrome_src()
  }
  return chrome_src
}

function lines_from_file(file) {
  const result = []
  const lines = FS.readFileSync(file, 'utf8').split('\n')
  for (const line of lines) {
    const key = line.trim()
    if (key.length == 0)
      continue

    result.push(key)
  }
  return result
}

function filter_map_from_file(file) {
  const result = new Map
  let filter_key = ''
  let filter_list = []
  const file_prefix = 'file '
  const buf = FS.readFileSync(file, 'utf8')
  const len = buf.length
  let i = 0
  while (i < len) {
    i = skip_whitespace(buf, len, i)
    if (i == len)
      break

    // expect ` or file
    if (buf[i] != '`' && !buf.startsWith(file_prefix, i))
      error_exit(`expect \` or file but got ${buf[i]}, offset ${i}`)

    if (buf[i] == '`') {
      // skip `
      i++
      if (i == len)
        error_exit('unexpected eof')

      // get until `
      let key = ''
      while (i < len && buf[i] != '`') {
        key += buf[i]
        i++
      }
      if (i == len)
        error_exit(`unexpected eof`)

      // skip `
      i++

      i = skip_whitespace(buf, len, i)
      if (i == len)
        error_exit(`unexpected eof`)

      // expect =
      if (buf[i] != '=')
        error_exit(`expect = but got ${buf[i]}, offset: ${i}`)

      // skip =
      i++

      i = skip_whitespace(buf, len, i)
      if (i == len)
        error_exit(`unexpected eof`)

      // expect `
      if (buf[i] != '`')
        error_exit(`expect \` but got ${buf[i]}, offset: ${i}`)

      // skip `
      i++

      // get until `
      let value = ''
      while (i < len && buf[i] != '`') {
        value += buf[i]
        i++
      }

      if (i == len)
        error_exit(`unexpected eof when get value for key ${key}, offset: ${i}`)

      filter_list.push([key, value])

      // skip `
      i++
    } else {
      if (filter_list.length > 0) {
        result.set(filter_key, filter_list);
      }

      i += file_prefix.length
      i = skip_whitespace(buf, len, i)
      if (i == len)
        error_exit(`unexpected eof`)

      // get file value
      filter_list = []
      filter_key = ''
      while (i < len && !is_whitespace(buf[i])) {
        filter_key += buf[i]
        i++
      }

      // skip until eol
      while (i < len && buf[i] != '\n') {
        i++
      }
      if (i != len) {
        // skip \n
        i++
      }
    }
  }
  if (filter_list.length > 0) {
    result.set(filter_key, filter_list);
  }
  return result
}

function load_locale_branding_map() {
  const map = new Map
  const prefix = 'BRANDING_'
  for (const file of FS.readdirSync(config_dir, {withFileTypes: true})) {
    if (file.isFile() && file.name.startsWith(prefix) &&
        file.name.length > prefix.length) {
      const lang = file.name.substr(prefix.length)
      map.set(lang, map_from_file(PATH.join(config_dir, file.name)))
    }
  }
  return map
}

function write_map_file(map, file) {
  let string = ''
  for (const [key, value] of map) {
    string += `${key}=${value}\n`
  }
  FS.writeFileSync(file, string)
}

function update_branding_file() {
  const path = 'chrome/app/theme/chromium/BRANDING'
  const branding_file = PATH.join(chrome_src, path)
  const current_map = map_from_file(branding_file)
  const map_override =
      map_from_file(PATH.join(config_dir, 'BRANDING'))
  for (const [key, value] of map_override) {
    current_map.set(key, value)
  }
  write_map_file(current_map, branding_file)
  log(`update ${path}`)
  return current_map
}

function reserved_map_from_file() {
  const map = new Map
  const lines =
      lines_from_file(PATH.join(config_dir, 'grd_reserved.txt'))
  for (const line of lines) {
    map.set(line, md5(line))
  }
  return map
}

function product_info_for_path(path, en_branding_map, locale_branding_map) {
  const basename = PATH.basename(path)
  if (basename.endsWith('.xtb') && basename.includes('_')) {
    const index = basename.lastIndexOf('_')
    const endindex = basename.lastIndexOf('.')
    const lang = basename.substr(index + 1, endindex - index - 1)
    if (locale_branding_map.has(lang)) {
      const map = locale_branding_map.get(lang)
      const company_fullname = map.get('COMPANY_FULLNAME')
      const product_fullname = map.get('PRODUCT_FULLNAME')
      return [company_fullname, product_fullname]
    }
  }
  const company_fullname = en_branding_map.get('COMPANY_FULLNAME')
  const product_fullname = en_branding_map.get('PRODUCT_FULLNAME')
  return [company_fullname, product_fullname]
}

function replace_tranid_in_grd(grd_file, parse_result) {
  if (parse_result.xtb_files.length == 0)
    return

  const change_map = new Map
  for (const file of [grd_file, ...parse_result.part_files]) {
    if (!FS.existsSync(file)) {
      warn(`no such file: ${file}`)
      continue
    }

    const origin = file + '.origin'
    const list1 = tranid_list_from_file(origin)
    const list2 = tranid_list_from_file(file)
    if (list1.length != list2.length)
      error_exit(`length not equal, file: ${origin} and ${file}`)

    for (let i = 0; i < list1.length; i++) {
      const [key1, value1] = list1[i]
      const [key2, value2] = list2[i]
      if (key1 != key2)
        error_exit(`key not equal, key1: ${key1} key2: ${key2} file: ${origin} and ${file}`)

      if (value1 != value2) {
        change_map.set(value1, value2)
      }
    }
  }
  if (change_map.size == 0)
      return

  for (const file of parse_result.xtb_files) {
    if (!FS.existsSync(file)) {
      warn(`no such file: ${file}`)
      continue
    }

    replace_tranid_in_xtb(file, change_map)
    log(`replace tranid ${PATH.relative(chrome_src, file)}`)
  }
}

function remove_origin_files(grd_file, parse_result) {
  for (const file of [grd_file, ...parse_result.part_files]) {
    const origin = file + '.origin'
    if (!FS.existsSync(origin))
      continue

    FS.unlinkSync(origin)
  }
}

function filter_grd_xtb(en_branding_map) {
  const reserved_map = reserved_map_from_file()
  const filter_map =
      filter_map_from_file(PATH.join(config_dir, 'grd_filter.map'))
  const locale_branding_map = load_locale_branding_map()

  function filter_one(path) {
    if (!FS.existsSync(path)) {
      warn(`no such file: ${path}`)
      return
    }

    const [company_fullname, product_fullname] =
        product_info_for_path(path, en_branding_map, locale_branding_map)

    function filter_value(value) {
      return value.replace('${company_fullname}', company_fullname).
          replace('${product_fullname}', product_fullname)
    }

    const replace_list = new Map
    for (const [key, value] of filter_map.get('')) {
      replace_list.set(key, filter_value(value))
    }
    const relpath = PATH.relative(chrome_src, path)
    if (filter_map.has(relpath)) {
      for (const [key, value] of filter_map.get(relpath)) {
        replace_list.set(key, filter_value(value))
      }
    }

    if (!path.endsWith('.xtb')) {
      const origin_path = path + '.origin'
      FS.copyFileSync(path, origin_path)
    }

    try {
      let contents = FS.readFileSync(path, 'utf8')
      for (const [key, value] of reserved_map) {
        const regexp = new RegExp(escape_pattern(key), 'g')
        contents = contents.replace(regexp, value)
      }
      contents = grdxtb_replace_contents(contents, replace_list)
      for (const [key, value] of reserved_map) {
        const regexp = new RegExp(escape_pattern(value), 'g')
        contents = contents.replace(regexp, key)
      }
      FS.writeFileSync(path, contents)
      log(`filter ${relpath}`)
    } catch (e) {
      error(`filter error: ${e}`)
    }
  }

  const files = lines_from_file(PATH.join(config_dir, 'grd_files.txt'))
  for (const file of files) {
    const path = PATH.join(chrome_src, file)
    if (!FS.existsSync(path)) {
      warn(`no such file: ${path}`)
      continue
    }
    filter_one(path)

    const result = parse_grd(path)
    for (const part_file of result.part_files) {
      filter_one(part_file)
    }
    for (const xtb_file of result.xtb_files) {
      filter_one(xtb_file)
    }
    replace_tranid_in_grd(path, result)
    remove_origin_files(path, result)
  }
}

function filter_source(en_branding_map) {
  const company_fullname = en_branding_map.get('COMPANY_FULLNAME')
  const product_fullname = en_branding_map.get('PRODUCT_FULLNAME')
  function filter_value(value) {
    return value.replace('${company_fullname}', company_fullname).
        replace('${product_fullname}', product_fullname)
  }
  const filter_map =
      filter_map_from_file(PATH.join(config_dir, 'src_filter.map'))
  const src_files = lines_from_file(PATH.join(config_dir, 'src_files.txt'))
  for (const file of src_files) {
    const path = PATH.join(chrome_src, file)
    if (!FS.existsSync(path)) {
      warn(`no such file: ${path}`)
      continue
    }

    const replace_list = new Map
    for (const [key, value] of filter_map.get('')) {
      replace_list.set(key, filter_value(value))
    }
    const relpath = PATH.relative(chrome_src, path)
    if (filter_map.has(relpath)) {
      for (const [key, value] of filter_map.get(relpath)) {
        replace_list.set(key, filter_value(value))
      }
    }
    filter_file_contents(path, replace_list)
    log(`filter ${relpath}`)
  }
}

function list_files_in_dir(dir) {
  function walk_dir(dir, file_list) {
    const list = FS.readdirSync(dir, {withFileTypes: true})
    for (const file of list) {
      if (file.name.startsWith('.'))
        continue
        
      const path = PATH.join(dir, file.name)
      if (file.isFile()) {
        file_list.push(path)
      } else if (file.isDirectory()) {
        walk_dir(path, file_list)
      }
    }
  }

  const list = []
  walk_dir(dir, list)
  return list
}

function copy_resources() {
  const res_dir = PATH.join(config_dir, 'res')
  if (!is_dir(res_dir)) {
    warn(`res dir not exists: ${res_dir}`)
    return
  }

  const files = list_files_in_dir(res_dir)
  for (const file of files) {
    const relpath = PATH.relative(res_dir, file)
    const target = PATH.join(chrome_src, relpath)
    if (!FS.existsSync(target)) {
      warn(`no such file: ${target}`)
      continue
    }

    FS.copyFileSync(file, target)
    log(`copy ${relpath}`)
  }
}

function rebrand() {
  const en_branding_map = update_branding_file()
  filter_grd_xtb(en_branding_map)
  filter_source(en_branding_map)
  copy_resources()
}

function run() {
  const args = parse_args()
  if (args.help) {
    help_exit()
  }

  if (args.version) {
    const pjson = require('../package.json')
    log(pjson.version)
    process.exit(0)
  }

  chrome_src = get_chrome_src(args)
  if (!chrome_src)
    error_exit('no chrome source dir found')

  if (args.argv.length == 0)
    error_exit(`config_dir needed`)

  config_dir = args.argv[0]
  if (!is_dir(config_dir))
    error_exit(`no such dir: ${config_dir}`)

  rebrand()
}

module.exports.run = run
