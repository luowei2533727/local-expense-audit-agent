import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { User } from '../../types';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { policyApi } from '../../lib/api';
import { useToast } from '../ui/Toast';
import { useQueryClient } from '@tanstack/react-query';
import { roleLabel } from '../../lib/i18n';

interface Step {
  step_order: number;
  approver_role?: string;
  approver_user_id?: string;
}

interface Props {
  users: User[];
  onCreated?: () => void;
}

const ruleTypeDescriptions = {
  SEQUENTIAL: '所有审批人按步骤依次审批，每一步均需通过。',
  PERCENTAGE: '达到指定比例的审批人通过后，报销即视为通过。',
  SPECIFIC: '指定审批人通过后，报销即视为通过。',
  HYBRID: '达到比例阈值或指定审批人通过，任一条件满足即可。',
};

export function RuleBuilder({ users, onCreated }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [ruleType, setRuleType] = useState<'SEQUENTIAL' | 'PERCENTAGE' | 'SPECIFIC' | 'HYBRID'>('SEQUENTIAL');
  const [percentageThreshold, setPercentageThreshold] = useState('');
  const [specificApproverId, setSpecificApproverId] = useState('');
  const [steps, setSteps] = useState<Step[]>([{ step_order: 1, approver_role: 'MANAGER' }]);
  const [saving, setSaving] = useState(false);

  const addStep = () => {
    setSteps([...steps, { step_order: steps.length + 1, approver_role: 'MANAGER' }]);
  };

  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_order: i + 1 })));
  };

  const updateStep = (index: number, updates: Partial<Step>) => {
    setSteps(steps.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  };

  const generatePreview = (): string => {
    if (steps.length === 0) return '请至少添加一个审批步骤。';

    const stepDescs = steps.map((s, i) => {
      const approver = s.approver_user_id
        ? users.find((u) => u.id === s.approver_user_id)?.email || '未知用户'
        : roleLabel(s.approver_role || '');
      return `步骤 ${i + 1}：${approver}`;
    });

    const base = stepDescs.join(' → ');

    switch (ruleType) {
      case 'SEQUENTIAL':
        return `${base}。所有步骤必须依次通过。`;
      case 'PERCENTAGE':
        return `${base}。达到 ${percentageThreshold || 'X'}% 的审批人通过后生效。`;
      case 'SPECIFIC': {
        const specific = specificApproverId
          ? users.find((u) => u.id === specificApproverId)?.email
          : '指定审批人';
        return `${base}。${specific} 通过后生效。`;
      }
      case 'HYBRID': {
        const specific = specificApproverId
          ? users.find((u) => u.id === specificApproverId)?.email
          : '指定审批人';
        return `${base}。达到 ${percentageThreshold || 'X'}% 通过，或由 ${specific} 通过后生效。`;
      }
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast('请填写策略名称', 'error');
      return;
    }
    if (steps.length === 0) {
      toast('至少需要一个审批步骤', 'error');
      return;
    }

    setSaving(true);
    try {
      await policyApi.create({
        name: name.trim(),
        rule_type: ruleType,
        percentage_threshold: percentageThreshold ? parseFloat(percentageThreshold) : undefined,
        specific_approver_id: specificApproverId || undefined,
        steps: steps.map((s) => ({
          step_order: s.step_order,
          approver_role: s.approver_user_id ? undefined : s.approver_role,
          approver_user_id: s.approver_user_id || undefined,
        })),
      });

      toast('审批策略创建成功', 'success');
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      setName('');
      setSteps([{ step_order: 1, approver_role: 'MANAGER' }]);
      setRuleType('SEQUENTIAL');
      setPercentageThreshold('');
      setSpecificApproverId('');
      onCreated?.();
    } catch {
      toast('创建审批策略失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const userOptions = [{ value: '', label: '按角色审批' }, ...users.map((u) => ({ value: u.id, label: u.email }))];
  const roleOptions = [
    { value: 'ADMIN', label: '管理员' },
    { value: 'MANAGER', label: '经理' },
    { value: 'EMPLOYEE', label: '员工' },
  ];

  return (
    <div className="space-y-6">
      <Input
        label="策略名称"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="例如：标准报销审批"
      />

      <Select
        label="规则类型"
        value={ruleType}
        onChange={(e) => setRuleType(e.target.value as typeof ruleType)}
        options={[
          { value: 'SEQUENTIAL', label: '顺序审批' },
          { value: 'PERCENTAGE', label: '比例审批' },
          { value: 'SPECIFIC', label: '指定审批人' },
          { value: 'HYBRID', label: '混合审批' },
        ]}
      />

      <p className="text-xs text-gray-500 bg-surface rounded-lg px-3 py-2 border border-gray-100">
        {ruleTypeDescriptions[ruleType]}
      </p>

      {/* Conditional fields */}
      {(ruleType === 'PERCENTAGE' || ruleType === 'HYBRID') && (
        <Input
          label="通过比例阈值（%）"
          type="number"
          min="1"
          max="100"
          value={percentageThreshold}
          onChange={(e) => setPercentageThreshold(e.target.value)}
          placeholder="例如：50"
        />
      )}

      {(ruleType === 'SPECIFIC' || ruleType === 'HYBRID') && (
        <Select
          label="指定审批人"
          value={specificApproverId}
          onChange={(e) => setSpecificApproverId(e.target.value)}
          options={users.map((u) => ({ value: u.id, label: u.email }))}
          placeholder="请选择审批人"
        />
      )}

      {/* Steps */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-text-primary">审批步骤</h4>
          <Button variant="outline" size="sm" onClick={addStep}>
            <Plus className="h-4 w-4" />
            添加步骤
          </Button>
        </div>

        {steps.map((step, index) => (
          <Card key={index} className="border-gray-100">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-gray-400">
                  <GripVertical className="h-4 w-4" />
                  <Badge variant="gray" className="w-6 h-6 rounded-full p-0 justify-center">
                    {step.step_order}
                  </Badge>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <Select
                    label="指定用户（可选）"
                    value={step.approver_user_id || ''}
                    onChange={(e) => updateStep(index, {
                      approver_user_id: e.target.value || undefined,
                      approver_role: e.target.value ? undefined : step.approver_role,
                    })}
                    options={userOptions}
                  />
                  {!step.approver_user_id && (
                    <Select
                      label="审批角色"
                      value={step.approver_role || 'MANAGER'}
                      onChange={(e) => updateStep(index, { approver_role: e.target.value })}
                      options={roleOptions}
                    />
                  )}
                </div>
                {steps.length > 1 && (
                  <button
                    onClick={() => removeStep(index)}
                    className="text-danger hover:text-red-700 transition-colors p-1"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Live Preview */}
      <Card className="bg-primary-50 border-primary-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-primary">规则预览</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-primary-700">{generatePreview()}</p>
        </CardContent>
      </Card>

      <Button onClick={handleSave} loading={saving} className="w-full">
        保存策略
      </Button>
    </div>
  );
}
