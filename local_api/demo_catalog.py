"""Generic medicine names supplied by the user; every commercial fact is invented."""
import copy

MEDICINES = (
    ('阿莫西林胶囊', 'Amoxicillin Capsules', '胶囊剂', '盒', ('0.25g × 24粒/盒', '0.5g × 20粒/盒', '0.25g × 48粒/盒')),
    ('头孢克肟胶囊', 'Cefixime Capsules', '胶囊剂', '盒', ('0.1g × 10粒/盒', '0.2g × 6粒/盒', '0.1g × 20粒/盒')),
    ('布洛芬片', 'Ibuprofen Tablets', '片剂', '盒', ('0.2g × 24片/盒', '0.1g × 100片/盒', '0.4g × 12片/盒')),
    ('扑热息痛片', 'Paracetamol Tablets', '片剂', '盒', ('0.5g × 20片/盒', '0.5g × 100片/盒', '0.3g × 24片/盒')),
    ('注射用头孢曲松钠', 'Ceftriaxone Sodium for Injection', '粉针剂', '支', ('0.5g/支', '1g/支', '2g/支')),
    ('注射用万古霉素', 'Vancomycin for Injection', '粉针剂', '支', ('0.5g/支', '1g/支', '0.5g × 10支/盒')),
    ('双氯灭痛注射液', 'Diclofenac Injection', '水针剂', '支', ('3ml:75mg/支', '2ml:50mg/支', '3ml × 10支/盒')),
    ('氨甲环酸注射液', 'Tranexamic Acid Injection', '水针剂', '支', ('5ml:0.5g/支', '10ml:1g/支', '5ml × 5支/盒')),
    ('硫酸沙丁胺醇气雾剂', 'Salbutamol Sulfate Inhaler', '气雾剂', '瓶', ('100μg × 200揿/瓶', '100μg × 120揿/瓶', '100μg × 60揿/瓶')),
)


def enrich_catalog(data):
    # Clone only our fictional baseline structure, never a real supplier template.
    product_base = data['mdc_products'][0]
    alias_base = data['mdc_product_aliases'][0]
    variant_base = data['mdc_product_variants'][0]
    profile_base = data['packaging_profiles'][0]
    version_base = data['packaging_profile_versions'][0]
    for p in data['mdc_products']:
        p['manual_sort_order'] += len(MEDICINES)
        p['is_pinned'] = False
    for i, (name, english, form, unit, specs) in enumerate(MEDICINES, 1):
        key = f'DEMO-MED-{i:02}'
        product = dict(copy.deepcopy(product_base), id=key, product_code=key,
                       chinese_name=name, english_name=english, dosage_form=form,
                       product_type='finished_product', is_pinned=i <= 4, manual_sort_order=i,
                       notes='采用药品通用名的演示目录；规格、包装和全部交易均为虚构，不代表真实厂家的产品资料。')
        data['mdc_products'].append(product)
        data['mdc_product_aliases'].append(dict(copy.deepcopy(alias_base), id=key + '-ALIAS',
                                               product_id=key, alias='对乙酰氨基酚片' if i == 4 else english,
                                               alias_kind='common', language='zh' if i == 4 else 'en'))
        for v, specification in enumerate(specs, 1):
            variant_id, profile_id = key + f'-V{v}', key + f'-PKG{v}'
            data['mdc_product_variants'].append(dict(copy.deepcopy(variant_base),
                id=variant_id, product_id=key, specification=specification, dosage_form_override=form))
            profile = dict(copy.deepcopy(profile_base), id=profile_id, packaging_code=profile_id,
                           product_variant_id=variant_id, product_name=name, material_no=variant_id,
                           specification=specification, workshop=f'DEMO 虚构{form}车间')
            data['packaging_profiles'].append(profile)
            per_carton = (100, 200, 400)[v - 1]
            version = dict(copy.deepcopy(version_base), id=profile_id + '-VERSION', profile_id=profile_id,
                           packaging_description=f'虚构演示包装；{per_carton}{unit}/箱',
                           quantity_per_carton=per_carton, quantity_unit=unit + '/箱',
                           units_per_box=10 if unit == '盒' else None,
                           boxes_per_carton=per_carton if unit == '盒' else None,
                           derived_base_units_per_carton=per_carton * 10 if unit == '盒' else None,
                           change_reason='根据虚构场景新增演示包装，非真实厂家参数')
            data['packaging_profile_versions'].append(version)
    # Keep the familiar named medicines first, while retaining the old fictional
    # finished products and raw materials for mixed business-type demonstrations.
    data['mdc_products'].sort(key=lambda p: p['manual_sort_order'])
