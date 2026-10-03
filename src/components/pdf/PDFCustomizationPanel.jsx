import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import PDFTemplateSelector from './PDFTemplateSelector';

export default function PDFCustomizationPanel({ settings, onSettingsChange, showTemplateSelector = true }) {
  const [expandedSection, setExpandedSection] = useState('template');

  const handleChange = (key, value) => {
    onSettingsChange({
      ...settings,
      [key]: value
    });
  };

  const handlePageMarginChange = (side, value) => {
    onSettingsChange({
      ...settings,
      page_margins: {
        ...settings.page_margins,
        [side]: parseFloat(value) || 0
      }
    });
  };

  const ExpandableSection = ({ id, title, children }) => (
    <div className="border rounded-lg">
      <button
        onClick={() => setExpandedSection(expandedSection === id ? null : id)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
      >
        <h4 className="font-medium text-sm text-slate-900">{title}</h4>
        <ChevronDown
          className={`h-4 w-4 text-slate-600 transition-transform ${
            expandedSection === id ? 'rotate-180' : ''
          }`}
        />
      </button>
      {expandedSection === id && (
        <div className="border-t px-4 py-4 bg-slate-50 space-y-4">
          {children}
        </div>
      )}
    </div>
  );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-lg">PDF Customization</CardTitle>
        <CardDescription>
          Configure how your quotes and invoices appear in PDF format
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Template Selector */}
        {showTemplateSelector && (
          <div className="pb-4 border-b">
            <PDFTemplateSelector
              selected={settings.template}
              onSelect={(template) => handleChange('template', template)}
            />
          </div>
        )}

        <Tabs defaultValue="colors" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="colors">Colors</TabsTrigger>
            <TabsTrigger value="layout">Layout</TabsTrigger>
            <TabsTrigger value="content">Content</TabsTrigger>
          </TabsList>

          {/* Colors Tab */}
          <TabsContent value="colors" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-medium">Primary Color</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    type="color"
                    value={settings.primary_color}
                    onChange={(e) => handleChange('primary_color', e.target.value)}
                    className="h-10 w-12 p-1 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={settings.primary_color}
                    onChange={(e) => handleChange('primary_color', e.target.value)}
                    className="text-xs flex-1"
                    placeholder="#000000"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">Accent Color</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    type="color"
                    value={settings.accent_color}
                    onChange={(e) => handleChange('accent_color', e.target.value)}
                    className="h-10 w-12 p-1 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={settings.accent_color}
                    onChange={(e) => handleChange('accent_color', e.target.value)}
                    className="text-xs flex-1"
                    placeholder="#000000"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">Header Background</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    type="color"
                    value={settings.header_background_color}
                    onChange={(e) => handleChange('header_background_color', e.target.value)}
                    className="h-10 w-12 p-1 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={settings.header_background_color}
                    onChange={(e) => handleChange('header_background_color', e.target.value)}
                    className="text-xs flex-1"
                    placeholder="#000000"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">Header Text Color</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    type="color"
                    value={settings.header_text_color}
                    onChange={(e) => handleChange('header_text_color', e.target.value)}
                    className="h-10 w-12 p-1 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={settings.header_text_color}
                    onChange={(e) => handleChange('header_text_color', e.target.value)}
                    className="text-xs flex-1"
                    placeholder="#ffffff"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">Footer Color</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    type="color"
                    value={settings.footer_color}
                    onChange={(e) => handleChange('footer_color', e.target.value)}
                    className="h-10 w-12 p-1 cursor-pointer"
                  />
                  <Input
                    type="text"
                    value={settings.footer_color}
                    onChange={(e) => handleChange('footer_color', e.target.value)}
                    className="text-xs flex-1"
                    placeholder="#000000"
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Layout Tab */}
          <TabsContent value="layout" className="space-y-4">
            <div>
              <Label className="text-xs font-medium">Font Family</Label>
              <Select value={settings.font_family} onValueChange={(value) => handleChange('font_family', value)}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sans-serif">Sans Serif</SelectItem>
                  <SelectItem value="serif">Serif</SelectItem>
                  <SelectItem value="monospace">Monospace</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-medium">Base Font Size (points)</Label>
              <Input
                type="number"
                min="8"
                max="14"
                value={settings.font_size_base}
                onChange={(e) => handleChange('font_size_base', parseFloat(e.target.value))}
                className="mt-2"
              />
            </div>

            <div>
              <Label className="text-xs font-medium">Page Layout</Label>
              <Select value={settings.page_layout} onValueChange={(value) => handleChange('page_layout', value)}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single-column">Single Column</SelectItem>
                  <SelectItem value="two-column">Two Column</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-medium">Line Spacing</Label>
              <Select value={settings.line_spacing.toString()} onValueChange={(value) => handleChange('line_spacing', parseFloat(value))}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Single</SelectItem>
                  <SelectItem value="1.5">1.5x</SelectItem>
                  <SelectItem value="2">Double</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-medium">Item Border Style</Label>
              <Select value={settings.item_border_style} onValueChange={(value) => handleChange('item_border_style', value)}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="solid">Solid</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="pt-4 border-t">
              <Label className="text-xs font-medium block mb-3">Page Margins (inches)</Label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px] text-slate-600">Top</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={settings.page_margins.top}
                    onChange={(e) => handlePageMarginChange('top', e.target.value)}
                    className="mt-1 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-slate-600">Bottom</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={settings.page_margins.bottom}
                    onChange={(e) => handlePageMarginChange('bottom', e.target.value)}
                    className="mt-1 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-slate-600">Left</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={settings.page_margins.left}
                    onChange={(e) => handlePageMarginChange('left', e.target.value)}
                    className="mt-1 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-slate-600">Right</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={settings.page_margins.right}
                    onChange={(e) => handlePageMarginChange('right', e.target.value)}
                    className="mt-1 text-xs"
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Content Tab */}
          <TabsContent value="content" className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="show_logo"
                  checked={settings.show_logo}
                  onCheckedChange={(checked) => handleChange('show_logo', checked)}
                />
                <Label htmlFor="show_logo" className="text-xs font-medium cursor-pointer">
                  Show Company Logo
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="show_company_info"
                  checked={settings.show_company_info}
                  onCheckedChange={(checked) => handleChange('show_company_info', checked)}
                />
                <Label htmlFor="show_company_info" className="text-xs font-medium cursor-pointer">
                  Show Company Info
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="show_payment_terms"
                  checked={settings.show_payment_terms}
                  onCheckedChange={(checked) => handleChange('show_payment_terms', checked)}
                />
                <Label htmlFor="show_payment_terms" className="text-xs font-medium cursor-pointer">
                  Show Payment Terms
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="show_line_item_images"
                  checked={settings.show_line_item_images}
                  onCheckedChange={(checked) => handleChange('show_line_item_images', checked)}
                />
                <Label htmlFor="show_line_item_images" className="text-xs font-medium cursor-pointer">
                  Show Product Images
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="highlight_totals"
                  checked={settings.highlight_totals}
                  onCheckedChange={(checked) => handleChange('highlight_totals', checked)}
                />
                <Label htmlFor="highlight_totals" className="text-xs font-medium cursor-pointer">
                  Highlight Totals Section
                </Label>
              </div>
            </div>

            <div className="pt-4 border-t">
              <Label htmlFor="footer_text" className="text-xs font-medium">Footer Text</Label>
              <textarea
                id="footer_text"
                value={settings.footer_text || ''}
                onChange={(e) => handleChange('footer_text', e.target.value)}
                placeholder="Add custom footer text (optional)"
                rows="3"
                className="w-full mt-2 px-3 py-2 border rounded text-xs font-mono resize-none"
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}