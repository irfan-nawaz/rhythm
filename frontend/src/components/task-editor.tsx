'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { BusyButton, DayPicker, FormField, Segmented, Sheet, SwitchRow } from '@/components/kit';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { api, errorMessage, type Group, type Member, type ScheduleType, type Task } from '@/lib/api';
import { weekdayNames } from '@/lib/time';

interface Draft {
  groupId: string;
  title: string;
  emoji: string;
  scheduleType: ScheduleType;
  daysOfWeek: number[];
  checkDay: number;
  timesPerWeek: number;
  dueTime: string;
  notify: boolean;
  graceMinutes: number;
  assigneeMemberId: string;
  active: boolean;
}

function toDraft(task: Task | null, groupId: string): Draft {
  return {
    groupId: task?.groupId ?? groupId,
    title: task?.title ?? '',
    emoji: task?.emoji ?? '',
    scheduleType: task?.scheduleType ?? 'daily',
    daysOfWeek: task?.scheduleType === 'weekly' ? (task.daysOfWeek ?? []) : [1, 3, 5],
    checkDay: task?.scheduleType === 'weekly_quota' ? (task.daysOfWeek?.[0] ?? 7) : 7,
    timesPerWeek: task?.timesPerWeek ?? 2,
    dueTime: task?.dueTime ?? '09:00',
    notify: task?.notify ?? true,
    graceMinutes: task?.graceMinutes ?? 15,
    assigneeMemberId: task?.assigneeMemberId ?? '',
    active: task?.active ?? true,
  };
}

/** Create or edit a task. Pass task={null} to create one. */
export function TaskEditor({ open, onOpenChange, task, groups }: { open: boolean; onOpenChange: (open: boolean) => void; task: Task | null; groups: Group[] }) {
  const t = useTranslations('taskEditor');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const defaultGroup = groups.find((g) => g.kind === 'personal')?.id ?? groups[0]?.id ?? '';
  const [draft, setDraft] = useState<Draft>(() => toDraft(task, defaultGroup));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    if (open) {
      setDraft(toDraft(task, defaultGroup));
      setError(null);
    }
  }, [open, task, defaultGroup]);

  const members = useQuery({
    queryKey: ['group', draft.groupId],
    queryFn: () => api.get<{ members: Member[] }>(`/api/groups/${draft.groupId}`),
    enabled: open && Boolean(draft.groupId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['today'] });
  };

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = {
        title: d.title,
        emoji: d.emoji || null,
        scheduleType: d.scheduleType,
        daysOfWeek: d.scheduleType === 'weekly' ? d.daysOfWeek : d.scheduleType === 'weekly_quota' ? [d.checkDay] : null,
        timesPerWeek: d.scheduleType === 'weekly_quota' ? d.timesPerWeek : null,
        dueTime: d.dueTime,
        notify: d.notify,
        graceMinutes: d.graceMinutes,
        assigneeMemberId: d.assigneeMemberId || null,
        active: d.active,
      };
      return task ? api.patch(`/api/tasks/${task.id}`, body) : api.post('/api/tasks', { ...body, groupId: d.groupId });
    },
    onSuccess: () => {
      toast.success(task ? t('saved') : t('added'));
      refresh();
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/api/tasks/${task!.id}`),
    onSuccess: () => {
      toast.success(t('deleted'));
      refresh();
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.scheduleType === 'weekly' && draft.daysOfWeek.length === 0) {
      setError(t('pickDay'));
      return;
    }
    save.mutate(draft);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={task ? t('editTitle') : t('newTitle')}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        {!task && groups.length > 1 ? (
          <FormField label={t('group')}>
            {(id) => (
              <NativeSelect id={id} value={draft.groupId} onChange={(e) => setDraft((d) => ({ ...d, groupId: e.target.value, assigneeMemberId: '' }))}>
                {groups.map((g) => (
                  <NativeSelectOption key={g.id} value={g.id}>
                    {g.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}

        <div className="grid grid-cols-[5rem_1fr] gap-3">
          <FormField label={t('emoji')}>
            {(id) => <Input id={id} value={draft.emoji} onChange={(e) => set('emoji', e.target.value)} maxLength={8} className="text-center text-xl" placeholder="☕" />}
          </FormField>
          <FormField label={t('what')}>
            {(id) => <Input id={id} value={draft.title} onChange={(e) => set('title', e.target.value)} required maxLength={100} placeholder={t('whatPlaceholder')} />}
          </FormField>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold">{t('howOften')}</p>
          <Segmented
            label={t('howOften')}
            value={draft.scheduleType}
            onChange={(v) => set('scheduleType', v)}
            options={[
              { value: 'daily', label: t('daily') },
              { value: 'weekly', label: t('weekly') },
              { value: 'weekly_quota', label: t('quota') },
            ]}
          />
          {draft.scheduleType === 'weekly' ? <DayPicker value={draft.daysOfWeek} onChange={(v) => set('daysOfWeek', v)} /> : null}
          {draft.scheduleType === 'weekly_quota' ? (
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t('timesPerWeek')}>
                {(id) => (
                  <NativeSelect id={id} value={draft.timesPerWeek} onChange={(e) => set('timesPerWeek', Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <NativeSelectOption key={n} value={n}>
                        {n}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField label={t('checkOn')}>
                {(id) => (
                  <NativeSelect id={id} value={draft.checkDay} onChange={(e) => set('checkDay', Number(e.target.value))}>
                    {weekdayNames(locale).map((d) => (
                      <NativeSelectOption key={d.value} value={d.value}>
                        {d.long}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            </div>
          ) : null}
        </div>

        <FormField label={draft.scheduleType === 'weekly_quota' ? t('checkAt') : t('doneBy')}>
          {(id) => <Input id={id} type="time" value={draft.dueTime} onChange={(e) => set('dueTime', e.target.value)} required />}
        </FormField>

        <FormField label={t('who')}>
          {(id) => (
            <NativeSelect id={id} value={draft.assigneeMemberId} onChange={(e) => set('assigneeMemberId', e.target.value)}>
              <NativeSelectOption value="">{t('anyone')}</NativeSelectOption>
              {(members.data?.members ?? []).map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.isYou ? t('you', { name: m.name }) : m.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>

        <div className="flex flex-col gap-2">
          <SwitchRow checked={draft.notify} onChange={(v) => set('notify', v)} label={t('remind')} description={t('remindDescription')} />
          {draft.notify ? (
            <FormField label={t('remindAfter')}>
              {(id) => (
                <NativeSelect id={id} value={draft.graceMinutes} onChange={(e) => set('graceMinutes', Number(e.target.value))}>
                  {[0, 15, 30, 60, 120].map((n) => (
                    <NativeSelectOption key={n} value={n}>
                      {n === 0 ? t('rightAway') : t('minutes', { count: n })}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          ) : null}
          {task ? <SwitchRow checked={!draft.active} onChange={(v) => set('active', !v)} label={t('paused')} description={t('pausedDescription')} /> : null}
        </div>

        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {task ? (
            <BusyButton type="button" variant="ghost" className="text-destructive" onClick={() => remove.mutate()} busy={remove.isPending}>
              {t('delete')}
            </BusyButton>
          ) : (
            <span />
          )}
          <BusyButton type="submit" busy={save.isPending}>
            {task ? t('save') : t('add')}
          </BusyButton>
        </div>
      </form>
    </Sheet>
  );
}
