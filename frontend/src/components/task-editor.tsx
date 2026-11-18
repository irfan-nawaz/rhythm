'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { BusyButton, DayPicker, FormField, Sheet, SwitchRow } from '@/components/kit';
import { useMe } from '@/components/me';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { api, errorMessage, type AutoComplete, type Group, type Member, type ScheduleType, type Task } from '@/lib/api';
import { nowIn, weekdayNames } from '@/lib/time';

const REPEATS: ScheduleType[] = ['daily', 'weekly', 'weekly_quota', 'every_n_days', 'after_done', 'monthly', 'yearly', 'once'];
const AUTO: AutoComplete[] = ['breakfast', 'lunch', 'dinner', 'snack', 'workout'];
// 29 February is allowed for yearly dates; other years use the 28th.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const usesStartDate = (type: ScheduleType) => type === 'once' || type === 'every_n_days' || type === 'after_done';

interface Draft {
  groupId: string;
  title: string;
  emoji: string;
  scheduleType: ScheduleType;
  daysOfWeek: number[];
  checkDay: number;
  timesPerWeek: number;
  /** once: the date. every_n_days: the first date. after_done: when it's first due. */
  startDate: string;
  everyDays: string;
  afterDays: string;
  dayOfMonth: number;
  monthOfYear: number;
  dueTime: string;
  notify: boolean;
  remindAtDue: boolean;
  graceMinutes: number;
  assigneeMemberId: string;
  escalateMemberId: string;
  escalateAfterMinutes: number;
  autoComplete: AutoComplete | '';
  active: boolean;
}

function toDraft(task: Task | null, groupId: string, today: string): Draft {
  return {
    groupId: task?.groupId ?? groupId,
    title: task?.title ?? '',
    emoji: task?.emoji ?? '',
    scheduleType: task?.scheduleType ?? 'daily',
    daysOfWeek: task?.scheduleType === 'weekly' ? (task.daysOfWeek ?? []) : [1, 3, 5],
    checkDay: task?.scheduleType === 'weekly_quota' ? (task.daysOfWeek?.[0] ?? 7) : 7,
    timesPerWeek: task?.timesPerWeek ?? 2,
    startDate: task?.startDate ?? today,
    everyDays: String(task?.scheduleType === 'every_n_days' ? task.intervalDays : 3),
    afterDays: String(task?.scheduleType === 'after_done' ? task.intervalDays : 7),
    dayOfMonth: task?.dayOfMonth ?? Number(today.slice(8)),
    monthOfYear: task?.monthOfYear ?? Number(today.slice(5, 7)),
    dueTime: task?.dueTime ?? '09:00',
    notify: task?.notify ?? true,
    remindAtDue: task?.remindAtDue ?? false,
    graceMinutes: task?.graceMinutes ?? 15,
    assigneeMemberId: task?.assigneeMemberId ?? '',
    escalateMemberId: task?.escalateMemberId ?? '',
    escalateAfterMinutes: task?.escalateAfterMinutes ?? 30,
    autoComplete: task?.autoComplete ?? '',
    active: task?.active ?? true,
  };
}

function toBody(d: Draft) {
  const type = d.scheduleType;
  return {
    title: d.title,
    emoji: d.emoji || null,
    scheduleType: type,
    daysOfWeek: type === 'weekly' ? d.daysOfWeek : type === 'weekly_quota' ? [d.checkDay] : null,
    timesPerWeek: type === 'weekly_quota' ? d.timesPerWeek : null,
    startDate: usesStartDate(type) ? d.startDate : null,
    intervalDays: type === 'every_n_days' ? Number(d.everyDays) : type === 'after_done' ? Number(d.afterDays) : null,
    dayOfMonth: type === 'monthly' || type === 'yearly' ? d.dayOfMonth : null,
    monthOfYear: type === 'yearly' ? d.monthOfYear : null,
    dueTime: d.dueTime,
    notify: d.notify,
    remindAtDue: d.remindAtDue,
    graceMinutes: d.graceMinutes,
    assigneeMemberId: d.assigneeMemberId || null,
    escalateMemberId: d.notify && d.escalateMemberId ? d.escalateMemberId : null,
    escalateAfterMinutes: d.escalateAfterMinutes,
    autoComplete: d.autoComplete || null,
    active: d.active,
  };
}

/** Create or edit a task. Pass task={null} to create one. */
export function TaskEditor({ open, onOpenChange, task, groups }: { open: boolean; onOpenChange: (open: boolean) => void; task: Task | null; groups: Group[] }) {
  const t = useTranslations('taskEditor');
  const tMeals = useTranslations('food.meals');
  const locale = useLocale();
  const me = useMe();
  const today = nowIn(me.timezone).date;
  const queryClient = useQueryClient();
  const defaultGroup = groups.find((g) => g.kind === 'personal')?.id ?? groups[0]?.id ?? '';
  const [draft, setDraft] = useState<Draft>(() => toDraft(task, defaultGroup, today));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    if (open) {
      setDraft(toDraft(task, defaultGroup, today));
      setError(null);
    }
  }, [open, task, defaultGroup, today]);

  const members = useQuery({
    queryKey: ['group', draft.groupId],
    queryFn: () => api.get<{ members: Member[] }>(`/api/groups/${draft.groupId}`),
    enabled: open && Boolean(draft.groupId),
  });
  const people = members.data?.members ?? [];
  const personName = (m: Member) => (m.isYou ? t('you', { name: m.name }) : m.name);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['today'] });
    queryClient.invalidateQueries({ queryKey: ['calendar'] });
  };

  const save = useMutation({
    mutationFn: (d: Draft) => (task ? api.patch(`/api/tasks/${task.id}`, toBody(d)) : api.post('/api/tasks', { ...toBody(d), groupId: d.groupId })),
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
    if (usesStartDate(draft.scheduleType) && !draft.startDate) {
      setError(t('pickDate'));
      return;
    }
    save.mutate(draft);
  }

  const setMonth = (month: number) => setDraft((d) => ({ ...d, monthOfYear: month, dayOfMonth: Math.min(d.dayOfMonth, DAYS_IN_MONTH[month - 1]!) }));
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2028, i, 1, 12))),
  );
  const numberOptions = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => (
      <NativeSelectOption key={from + i} value={from + i}>
        {from + i}
      </NativeSelectOption>
    ));

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={task ? t('editTitle') : t('newTitle')}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        {!task && groups.length > 1 ? (
          <FormField label={t('group')}>
            {(id) => (
              <NativeSelect id={id} value={draft.groupId} onChange={(e) => setDraft((d) => ({ ...d, groupId: e.target.value, assigneeMemberId: '', escalateMemberId: '' }))}>
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
          <FormField label={t('howOften')}>
            {(id) => (
              <NativeSelect id={id} value={draft.scheduleType} onChange={(e) => set('scheduleType', e.target.value as ScheduleType)}>
                {REPEATS.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {t(`repeat.${type}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>

          {draft.scheduleType === 'weekly' ? <DayPicker value={draft.daysOfWeek} onChange={(v) => set('daysOfWeek', v)} /> : null}

          {draft.scheduleType === 'weekly_quota' ? (
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t('timesPerWeek')}>
                {(id) => (
                  <NativeSelect id={id} value={draft.timesPerWeek} onChange={(e) => set('timesPerWeek', Number(e.target.value))}>
                    {numberOptions(1, 7)}
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

          {draft.scheduleType === 'once' ? (
            <FormField label={t('date')}>{(id) => <Input id={id} type="date" value={draft.startDate} onChange={(e) => set('startDate', e.target.value)} required />}</FormField>
          ) : null}

          {draft.scheduleType === 'every_n_days' || draft.scheduleType === 'after_done' ? (
            <div className="grid grid-cols-2 gap-3">
              <FormField label={draft.scheduleType === 'every_n_days' ? t('everyHowMany') : t('daysAfter')}>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={draft.scheduleType === 'every_n_days' ? 2 : 1}
                    max={365}
                    required
                    value={draft.scheduleType === 'every_n_days' ? draft.everyDays : draft.afterDays}
                    onChange={(e) => set(draft.scheduleType === 'every_n_days' ? 'everyDays' : 'afterDays', e.target.value)}
                  />
                )}
              </FormField>
              <FormField label={draft.scheduleType === 'every_n_days' ? t('startingOn') : t('firstDue')}>
                {(id) => <Input id={id} type="date" value={draft.startDate} onChange={(e) => set('startDate', e.target.value)} required />}
              </FormField>
            </div>
          ) : null}

          {draft.scheduleType === 'monthly' ? (
            <FormField label={t('dayOfMonth')} hint={draft.dayOfMonth > 28 ? t('dayOfMonthHint') : undefined}>
              {(id) => (
                <NativeSelect id={id} value={draft.dayOfMonth} onChange={(e) => set('dayOfMonth', Number(e.target.value))}>
                  {numberOptions(1, 30)}
                  <NativeSelectOption value={31}>{t('lastDay')}</NativeSelectOption>
                </NativeSelect>
              )}
            </FormField>
          ) : null}

          {draft.scheduleType === 'yearly' ? (
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <FormField label={t('month')}>
                {(id) => (
                  <NativeSelect id={id} value={draft.monthOfYear} onChange={(e) => setMonth(Number(e.target.value))}>
                    {monthNames.map((name, i) => (
                      <NativeSelectOption key={name} value={i + 1}>
                        {name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField label={t('day')}>
                {(id) => (
                  <NativeSelect id={id} value={draft.dayOfMonth} onChange={(e) => set('dayOfMonth', Number(e.target.value))}>
                    {numberOptions(1, DAYS_IN_MONTH[draft.monthOfYear - 1]!)}
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
              {people.map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {personName(m)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>

        <FormField label={t('autoComplete')} hint={t('autoHint')}>
          {(id) => (
            <NativeSelect id={id} value={draft.autoComplete} onChange={(e) => set('autoComplete', e.target.value as AutoComplete | '')}>
              <NativeSelectOption value="">{t('autoNothing')}</NativeSelectOption>
              {AUTO.map((kind) => (
                <NativeSelectOption key={kind} value={kind}>
                  {kind === 'workout' ? t('autoWorkout') : tMeals(kind)}
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
          {/* A heads-up only makes sense with a gap before the late reminder, and
              a weekly quota has no single moment it's due. */}
          {draft.notify && draft.graceMinutes > 0 && draft.scheduleType !== 'weekly_quota' ? (
            <SwitchRow
              checked={draft.remindAtDue}
              onChange={(v) => set('remindAtDue', v)}
              label={t('remindAtDue')}
              description={t('remindAtDueDescription', { time: draft.dueTime })}
            />
          ) : null}
          {/* "If Papa hasn't taken his tablet by 9:30, tell me." */}
          {draft.notify ? (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <FormField label={t('tell')} hint={t('tellHint')}>
                {(id) => (
                  <NativeSelect id={id} value={draft.escalateMemberId} onChange={(e) => set('escalateMemberId', e.target.value)}>
                    <NativeSelectOption value="">{t('tellNobody')}</NativeSelectOption>
                    {people
                      .filter((m) => m.hasAccount)
                      .map((m) => (
                        <NativeSelectOption key={m.id} value={m.id}>
                          {personName(m)}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                )}
              </FormField>
              {draft.escalateMemberId ? (
                <FormField label={t('tellAfter')}>
                  {(id) => (
                    <NativeSelect id={id} value={draft.escalateAfterMinutes} onChange={(e) => set('escalateAfterMinutes', Number(e.target.value))}>
                      {[15, 30, 60, 120].map((n) => (
                        <NativeSelectOption key={n} value={n}>
                          {n < 60 ? t('minutes', { count: n }) : t('hours', { count: n / 60 })}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              ) : null}
            </div>
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
