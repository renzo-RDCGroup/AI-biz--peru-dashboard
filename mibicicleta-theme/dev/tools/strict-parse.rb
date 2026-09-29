# Parses every theme .liquid file with Shopify's Ruby Liquid gem in strict mode — the parser
# class Shopify uses on upload, which is stricter than Theme Check and the liquidjs preview.
# Shopify-only tags are registered as permissive tags/blocks so only real syntax errors surface.
# Usage: ruby tools/strict-parse.rb [theme_dir]   (exit 1 on any error)
require 'liquid'

class AnyTag < Liquid::Tag; end
class AnyBlock < Liquid::Block; end
class AnyRaw < Liquid::Raw; end

{ 'section' => AnyTag, 'sections' => AnyTag, 'layout' => AnyTag,
  'form' => AnyBlock, 'paginate' => AnyBlock, 'style' => AnyBlock,
  'schema' => AnyRaw, 'stylesheet' => AnyRaw, 'javascript' => AnyRaw, 'doc' => AnyRaw }.each do |name, klass|
  Liquid::Environment.default.register_tag(name, klass)
end

root = ARGV[0] || File.expand_path('../../theme', __dir__)
errors = 0
files = Dir.glob(File.join(root, '{layout,sections,snippets,templates,blocks}', '*.liquid')).sort
files.each do |f|
  # `{% render block %}` (app blocks) is a Shopify-only form of render that the gem rejects.
  src = File.read(f, encoding: 'UTF-8').gsub(/\{%-?\s*render\s+block\s*-?%\}/, '')
  begin
    Liquid::Template.parse(src, error_mode: :strict, line_numbers: true)
  rescue Liquid::Error => e
    errors += 1
    puts "#{f.sub(root + '/', '')}: #{e.message}"
  end
end
puts "#{files.size} files parsed, #{errors} with errors."
exit(errors.zero? ? 0 : 1)
