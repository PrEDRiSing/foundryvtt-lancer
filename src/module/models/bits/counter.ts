import { LIDField } from "../shared";

// @ts-ignore
const fields: any = foundry.data.fields;

export interface CounterData {
  lid: string;
  name: string;
  min: number;
  max: number | null;
  default_value: number;
  val: number;
}

// A single <type, value> pairing for damage. mimics RegCounterData
export class CounterField extends fields.SchemaField {
  constructor(options = {}) {
    super(
      {
        lid: new LIDField(),
        name: new fields.StringField(),
        min: new fields.NumberField(),
        max: new fields.NumberField({ required: false, nullable: true }),
        default_value: new fields.NumberField(),
        val: new fields.NumberField(),
      },
      options
    );
  }

  bound_val(value: CounterData, sub_val: number) {
    sub_val = Math.round(sub_val);
    sub_val = Math.max(sub_val, value.min);
    if (value.max !== null) sub_val = Math.min(sub_val, value.max);
    return sub_val;
  }

  /** @inheritdoc */
  clean(value: CounterData, data: any, options: any) {
    // Attempt to move our .val back in bounds
    value = super.clean(value, data, options);
    value.val = this.bound_val(value, value.val || 0);
    value.default_value = this.bound_val(value, value.default_value || 0);
    return value;
  }

  /** @override */
  _validateType(value: CounterData) {
    if (value.max !== null && value.max < value.min) throw new Error("max must be > min");
  }
}
